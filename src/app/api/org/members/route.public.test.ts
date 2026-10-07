// The shared public org's membership cannot be written by anyone (security scan 2026-10-07, finding
// S4). requireOrgRole("public", "owner") admits any signed-in viewer, so before the fix a stranger
// could grant any login (their own included) any role in the public org, owner included, and remove
// anyone else's row.

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
  getMembershipRole: vi.fn(async () => null),
  listOrgMembers: vi.fn(async () => []),
  setMembershipRole: vi.fn(async () => "ok"),
  removeMembership: vi.fn(async () => "ok"),
  recordOrgAudit: vi.fn(async () => {}),
}));

import { POST, DELETE } from "./route";
import { removeMembership, setMembershipRole } from "@/lib/db";

const post = (body: unknown) =>
  new Request("http://localhost/api/org/members", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const del = (qs: string) => new Request(`http://localhost/api/org/members?${qs}`, { method: "DELETE" });

beforeEach(() => vi.clearAllMocks());

describe("/api/org/members writes as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the owner gate", async () => {
    expect((await POST(post({ org: "acme", login: "stranger", role: "owner" }))).status).toBe(403);
    expect((await DELETE(del("org=acme&login=victim"))).status).toBe(403);
    expect(setMembershipRole).not.toHaveBeenCalled();
    expect(removeMembership).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("POST refuses %j: no one can grant themselves owner of the public org", async (org) => {
    const res = await POST(post({ org, login: "stranger", role: "owner" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(setMembershipRole).not.toHaveBeenCalled();
  });

  it("DELETE refuses removing someone else from the public org", async () => {
    expect((await DELETE(del("org=public&login=victim"))).status).toBe(403);
    expect(removeMembership).not.toHaveBeenCalled();
  });
});
