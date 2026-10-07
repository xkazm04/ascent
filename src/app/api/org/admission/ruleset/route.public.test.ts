// Admission rulesets cannot be applied or reverted on the shared public org (security scan 2026-10-07,
// finding O6). The shared gate refuses "public" right after requireOrgOwnerPost returns, dry runs
// included. Runs the REAL @/lib/authz and @/lib/api/orgPost.

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
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => false, isOrgAdminViaInstallation: vi.fn() }));
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
}));
vi.mock("@/lib/db/org-stance", () => ({ getActiveOrgStance: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-admission", () => ({
  getRepoAdmission: vi.fn(async () => null),
  setAdmissionRulesetId: vi.fn(async () => {}),
}));
vi.mock("@/lib/github/pr-route", () => ({
  repoUnderOrg: vi.fn(async (_org: string, repo: string) => repo),
  requirePrWriteTarget: vi.fn(async () => ({ token: "t", owner: "o", repo: "r" })),
  mapPrWriteError: vi.fn(),
}));
vi.mock("@/lib/github/admission-write", () => ({
  applyRuleset: vi.fn(async () => ({})),
  listRulesets: vi.fn(async () => []),
  revertRuleset: vi.fn(async () => {}),
}));

import { POST, DELETE } from "./route";
import { repoUnderOrg, requirePrWriteTarget } from "@/lib/github/pr-route";
import { setAdmissionRulesetId } from "@/lib/db/org-admission";

const req = (method: string, body: unknown) =>
  new Request("http://localhost/api/org/admission/ruleset", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("/api/org/admission/ruleset as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the owner gate", async () => {
    expect((await POST(req("POST", { org: "acme", repo: "acme/x", confirm: "acme/x" }))).status).toBe(403);
    expect(requirePrWriteTarget).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("POST refuses a ruleset on %j (dry run too)", async (org) => {
    for (const extra of [{ confirm: "vercel/next.js" }, { dryRun: true }]) {
      const res = await POST(req("POST", { org, repo: "vercel/next.js", ...extra }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    }
    expect(repoUnderOrg).not.toHaveBeenCalled();
    expect(requirePrWriteTarget).not.toHaveBeenCalled();
  });

  it("DELETE refuses reverting a ruleset on public", async () => {
    expect((await DELETE(req("DELETE", { org: "public", repo: "vercel/next.js", confirm: "vercel/next.js" }))).status).toBe(403);
    expect(requirePrWriteTarget).not.toHaveBeenCalled();
    expect(setAdmissionRulesetId).not.toHaveBeenCalled();
  });
});
