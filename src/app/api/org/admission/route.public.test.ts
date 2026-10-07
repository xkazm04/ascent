// Admission grants cannot be written on the shared public org (security scan 2026-10-07, finding O6).
// requireOrgOwnerPost admits "public" for any signed-in viewer; POST and DELETE refuse it right after
// the helper returns. Runs the REAL @/lib/authz and @/lib/api/orgPost.

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
  MAX_RATIONALE: 500,
  listOrgAdmissions: vi.fn(async () => []),
  upsertRepoAdmission: vi.fn(async () => ({})),
  deleteRepoAdmission: vi.fn(async () => true),
}));
vi.mock("@/lib/github/pr-route", () => ({
  parseRepoFullName: (s: string) => s,
  repoUnderOrg: vi.fn(async (_org: string, repo: string) => repo),
}));

import { POST, DELETE } from "./route";
import { deleteRepoAdmission, upsertRepoAdmission } from "@/lib/db/org-admission";

const req = (method: string, body: unknown) =>
  new Request("http://localhost/api/org/admission", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const grant = (org: string) => ({ org, repo: "vercel/next.js", grantedTier: "T1", mode: "advisory", rationale: "x" });

beforeEach(() => vi.clearAllMocks());

describe("/api/org/admission as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the owner gate", async () => {
    expect((await POST(req("POST", grant("acme")))).status).toBe(403);
    expect((await DELETE(req("DELETE", { org: "acme", repo: "acme/x" }))).status).toBe(403);
    expect(upsertRepoAdmission).not.toHaveBeenCalled();
    expect(deleteRepoAdmission).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("POST refuses writing a grant on %j", async (org) => {
    const res = await POST(req("POST", grant(org)));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(upsertRepoAdmission).not.toHaveBeenCalled();
  });

  it("DELETE refuses removing a grant on public", async () => {
    expect((await DELETE(req("DELETE", { org: "public", repo: "vercel/next.js" }))).status).toBe(403);
    expect(deleteRepoAdmission).not.toHaveBeenCalled();
  });
});
