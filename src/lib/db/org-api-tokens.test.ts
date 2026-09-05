// Unit tests for org API tokens (the sync keystone; mocked Prisma). Security-critical behavior:
//   - createOrgApiToken stores only a SHA-256 hash (never the raw token) + a display prefix;
//   - verifyOrgApiToken rejects a non-`askl_` bearer without a DB hit, recovers org slug + scopes on a
//     hash match, and returns null when the lookup misses (the query already filters revokedAt: null).

import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: async (slug: string) => (slug === "acme" ? "org_acme" : null) }));

import {
  createOrgApiToken,
  ensureOrgApiToken,
  revokeOrgApiTokensByName,
  verifyOrgApiToken,
} from "@/lib/db/org-api-tokens";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("createOrgApiToken", () => {
  it("persists a hash + prefix, never the raw token, and returns the raw once", async () => {
    let stored: Record<string, unknown> | null = null;
    mockGetPrisma.mockReturnValue({
      orgApiToken: {
        create: vi.fn(async (a: { data: Record<string, unknown> }) => {
          stored = a.data;
          return { id: "t1", name: a.data.name, tokenPrefix: a.data.tokenPrefix, scopes: a.data.scopes, createdBy: null, lastUsedAt: null, createdAt: new Date() };
        }),
      },
    });
    const res = await createOrgApiToken("acme", { name: "CI", scopes: ["skills:read", "skills:write"] });
    expect(res?.token.startsWith("askl_")).toBe(true);
    // The persisted row carries the hash of the raw token, not the token itself.
    expect(stored!.tokenHash).toBe(sha(res!.token));
    expect(stored!.content).toBeUndefined();
    expect(String(stored!.tokenPrefix).length).toBe(12);
    expect(res!.summary.scopes).toEqual(["skills:read", "skills:write"]);
  });

  it("never mints an empty-scope token (defaults to skills:read)", async () => {
    mockGetPrisma.mockReturnValue({
      orgApiToken: { create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: "t", ...a.data, lastUsedAt: null, createdAt: new Date() })) },
    });
    const res = await createOrgApiToken("acme", { name: "x", scopes: [] });
    expect(res!.summary.scopes).toEqual(["skills:read"]);
  });
});

describe("verifyOrgApiToken", () => {
  it("rejects a bearer without the askl_ prefix without touching the DB", async () => {
    const findFirst = vi.fn();
    mockGetPrisma.mockReturnValue({ orgApiToken: { findFirst } });
    expect(await verifyOrgApiToken("asc_otel.acme.deadbeef")).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("recovers the org slug + scopes on a hash match and bumps lastUsedAt", async () => {
    const raw = "askl_" + "a".repeat(32);
    const update = vi.fn(async () => ({}));
    mockGetPrisma.mockReturnValue({
      orgApiToken: {
        findFirst: vi.fn(async ({ where }: { where: { tokenHash: string; revokedAt: null } }) =>
          where.tokenHash === sha(raw) && where.revokedAt === null
            ? { id: "t1", name: "CI", scopes: "skills:read,telemetry:write", tokenHash: sha(raw), org: { slug: "acme" } }
            : null,
        ),
        update,
      },
    });
    const v = await verifyOrgApiToken(raw);
    expect(v).toEqual({ tokenId: "t1", orgSlug: "acme", name: "CI", scopes: ["skills:read", "telemetry:write"] });
    expect(update).toHaveBeenCalledOnce();
  });

  it("returns null when no active token matches", async () => {
    mockGetPrisma.mockReturnValue({ orgApiToken: { findFirst: vi.fn(async () => null) } });
    expect(await verifyOrgApiToken("askl_" + "b".repeat(32))).toBeNull();
  });
});

// moonshot #35 — the reuse-or-mint door used by report-back provisioning. The property worth pinning
// is the HONEST one: a reused token's raw value is unrecoverable, so `token` must be null there rather
// than some placeholder a caller could mistake for a working credential and write into a repo secret.
describe("ensureOrgApiToken", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "t1",
    name: "conformance report-back",
    tokenPrefix: "askl_OLDPREF",
    scopes: "telemetry:write",
    createdBy: null,
    lastUsedAt: null,
    createdAt: new Date(),
    ...over,
  });

  it("reuses an existing token by name and returns token:null (the raw value is unrecoverable)", async () => {
    const create = vi.fn();
    mockGetPrisma.mockReturnValue({
      orgApiToken: { findFirst: vi.fn(async () => row()), create, updateMany: vi.fn() },
    });
    const res = await ensureOrgApiToken("acme", { name: "conformance report-back", scopes: ["telemetry:write"] });
    expect(res).toMatchObject({ token: null, reused: true });
    expect(res!.summary.tokenPrefix).toBe("askl_OLDPREF");
    expect(create).not.toHaveBeenCalled();
  });

  it("mints when nothing by that name exists", async () => {
    mockGetPrisma.mockReturnValue({
      orgApiToken: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async (a: { data: Record<string, unknown> }) => row({ ...a.data })),
        updateMany: vi.fn(),
      },
    });
    const res = await ensureOrgApiToken("acme", { name: "conformance report-back", scopes: ["telemetry:write"] });
    expect(res!.reused).toBe(false);
    expect(res!.token!.startsWith("askl_")).toBe(true);
  });

  it("rotate:true revokes EVERY live token of that name, then mints a fresh one", async () => {
    const updateMany = vi.fn(async () => ({ count: 2 }));
    mockGetPrisma.mockReturnValue({
      orgApiToken: {
        findFirst: vi.fn(async () => row()),
        create: vi.fn(async (a: { data: Record<string, unknown> }) => row({ ...a.data })),
        updateMany,
      },
    });
    const res = await ensureOrgApiToken("acme", {
      name: "conformance report-back",
      scopes: ["telemetry:write"],
      rotate: true,
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ name: "conformance report-back", revokedAt: null }) }),
    );
    expect(res!.reused).toBe(false);
    expect(res!.token).toBeTruthy();
  });

  it("is null for an unknown org (no mint, no revoke)", async () => {
    const updateMany = vi.fn();
    mockGetPrisma.mockReturnValue({ orgApiToken: { findFirst: vi.fn(), create: vi.fn(), updateMany } });
    expect(await ensureOrgApiToken("nope", { name: "x", scopes: ["telemetry:write"] })).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("revokeOrgApiTokensByName", () => {
  it("retires every live token of that name and reports the count", async () => {
    const updateMany = vi.fn(async () => ({ count: 3 }));
    mockGetPrisma.mockReturnValue({ orgApiToken: { updateMany } });
    expect(await revokeOrgApiTokensByName("acme", "conformance report-back")).toBe(3);
    expect(updateMany.mock.calls[0]![0]).toMatchObject({
      where: { orgId: "org_acme", name: "conformance report-back", revokedAt: null },
    });
  });

  it("is 0 for an unknown org, touching nothing", async () => {
    const updateMany = vi.fn();
    mockGetPrisma.mockReturnValue({ orgApiToken: { updateMany } });
    expect(await revokeOrgApiTokensByName("nope", "x")).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
