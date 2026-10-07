// A CODEOWNERS proposal cannot be made for the shared public org (security scan 2026-10-07, finding
// O6). The route's PR write is already stopped downstream for "public" (requirePrWriteTarget cannot
// mint an installation token for it), but it admitted "public" at the gate; it now refuses there like
// its siblings. Runs the REAL @/lib/authz and @/lib/api/orgPost.

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
vi.mock("@/lib/db/org-admission", () => ({ getRepoAdmission: vi.fn(async () => null) }));
vi.mock("@/lib/github/pr-route", () => ({
  repoUnderOrg: vi.fn(async (_org: string, repo: string) => repo),
  requirePrWriteTarget: vi.fn(async () => ({ token: "t", owner: "o", repo: "r" })),
  mapPrWriteError: vi.fn(),
}));
vi.mock("@/lib/github/admission-write", () => ({ proposeManagedBlock: vi.fn(async () => ({})) }));

import { POST } from "./route";
import { repoUnderOrg } from "@/lib/github/pr-route";

const req = (body: unknown) =>
  new Request("http://localhost/api/org/admission/propose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/org/admission/propose as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the owner gate", async () => {
    expect((await POST(req({ org: "acme", repo: "acme/x", owners: ["@acme/t"] }))).status).toBe(403);
    expect(repoUnderOrg).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("refuses a proposal for %j before touching any repo", async (org) => {
    const res = await POST(req({ org, repo: "vercel/next.js", owners: ["@vercel/t"], confirm: true }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(repoUnderOrg).not.toHaveBeenCalled();
  });
});
