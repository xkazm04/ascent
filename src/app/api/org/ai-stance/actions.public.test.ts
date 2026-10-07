// The shared public org's AI stance cannot be acknowledged or applied to repos by anyone (security
// scan 2026-10-07, finding O7). requireOrgRole admits "public" for any signed-in viewer; ack, apply and
// apply-batch refuse it before the gate. Runs the REAL @/lib/authz.

import { describe, it, expect, vi, beforeEach } from "vitest";

// The REAL @/lib/authz runs; only its identity and data edges are stubbed. The caller is a signed-in
// account under the login wall with no Membership anywhere, and every org already has an owner (so
// there is no bootstrap claim either): a stranger.
vi.mock("@/lib/access", () => ({
  authGateEnabled: () => true,
  getViewer: vi.fn(async () => ({ id: "u1", login: "stranger" })),
  requireViewer: vi.fn(async () => null),
  resolveViewerLogin: vi.fn(async () => "stranger"),
}));
vi.mock("@/lib/auth", () => ({
  PUBLIC_ORG: "public",
  getSession: vi.fn(async () => null),
  isAuthConfigured: () => false,
  requireSameOrigin: vi.fn(() => null),
}));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => true, AppApiError: class extends Error {}, isOrgAdminViaInstallation: vi.fn() }));
vi.mock("@/lib/db/members", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/members")>()),
  getMembershipRole: vi.fn(async () => null),
  orgHasOwner: vi.fn(async () => true),
  ensureOwnerMembership: vi.fn(async () => {}),
}));
vi.mock("@/lib/db", () => ({
  getInstallationIdForOwner: vi.fn(async () => null),
  isDbConfigured: () => true,
  isPersonalOrg: vi.fn(async () => false),
  recordOrgAudit: vi.fn(async () => {}),
  getActiveOrgStance: vi.fn(async () => ({ version: 1, stance: {} })),
  getOrgId: vi.fn(async () => "org-1"),
  ackOrgStance: vi.fn(async () => ({ repoFullName: "public/x" })),
}));
vi.mock("@/lib/github/pr-route", () => ({
  classifyPrWriteError: vi.fn(),
  mapPrWriteError: vi.fn(),
  requirePrWriteTarget: vi.fn(async () => ({ token: "t" })),
  resolvePrWriteCoordinate: vi.fn(async () => ({})),
}));
vi.mock("@/lib/org/stance-apply", () => ({ applyStanceToRepo: vi.fn(async () => ({})) }));

import { POST as ack } from "./ack/route";
import { POST as apply } from "./apply/route";
import { POST as applyBatch } from "./apply-batch/route";
import { ackOrgStance, getActiveOrgStance } from "@/lib/db";
import { applyStanceToRepo } from "@/lib/org/stance-apply";

const req = (path: string, body: unknown) =>
  new Request(`http://localhost/api/org/ai-stance/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("/api/org/ai-stance/{ack,apply,apply-batch} as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the admin gate", async () => {
    expect((await ack(req("ack", { org: "acme", repo: "acme/x" }))).status).toBe(403);
    expect((await apply(req("apply", { org: "acme", repo: "acme/x" }))).status).toBe(403);
    expect((await applyBatch(req("apply-batch", { org: "acme", repos: ["acme/x"] }))).status).toBe(403);
    expect(ackOrgStance).not.toHaveBeenCalled();
    expect(applyStanceToRepo).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("ack refuses acknowledging on %j", async (org) => {
    const res = await ack(req("ack", { org, repo: "public/x" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(ackOrgStance).not.toHaveBeenCalled();
  });

  it("apply refuses opening a policy PR for public", async () => {
    expect((await apply(req("apply", { org: "public", repo: "public/x" }))).status).toBe(403);
    expect(getActiveOrgStance).not.toHaveBeenCalled();
    expect(applyStanceToRepo).not.toHaveBeenCalled();
  });

  it("apply-batch refuses opening policy PRs for public", async () => {
    expect((await applyBatch(req("apply-batch", { org: "public", repos: ["public/x"] }))).status).toBe(403);
    expect(getActiveOrgStance).not.toHaveBeenCalled();
    expect(applyStanceToRepo).not.toHaveBeenCalled();
  });
});
