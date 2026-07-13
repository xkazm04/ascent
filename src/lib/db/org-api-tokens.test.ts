// Unit tests for org API tokens (the sync keystone; mocked Prisma). Security-critical behavior:
//   - createOrgApiToken stores only a SHA-256 hash (never the raw token) + a display prefix;
//   - verifyOrgApiToken rejects a non-`askl_` bearer without a DB hit, recovers org slug + scopes on a
//     hash match, and returns null when the lookup misses (the query already filters revokedAt: null).

import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: async (slug: string) => (slug === "acme" ? "org_acme" : null) }));

import { createOrgApiToken, verifyOrgApiToken } from "@/lib/db/org-api-tokens";

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
