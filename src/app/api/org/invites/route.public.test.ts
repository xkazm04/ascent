// The shared public org's invites cannot be minted, resent, revoked or listed by anyone (security scan
// 2026-10-07, finding S5). requireOrgRole("public", "owner") admits any signed-in viewer, so before
// the fix a stranger could mint an admin invite link to the public org, mail it from this deployment
// to any address, revoke other people's invites, and read the pending list with its invitee emails.

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
const invite = { id: "inv_1", email: "victim@example.test", role: "admin", token: "t", expiresAt: "2026-11-01T00:00:00.000Z" };
vi.mock("@/lib/db", () => ({
  getInstallationIdForOwner: vi.fn(async () => null),
  isDbConfigured: () => true,
  isPersonalOrg: vi.fn(async () => false),
  createInvite: vi.fn(async () => invite),
  listPendingInvites: vi.fn(async () => [invite]),
  revokeInvite: vi.fn(async () => ({ revoked: true, target: "victim@example.test" })),
  recordOrgAudit: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/invites", () => ({ resendInvite: vi.fn(async () => invite) }));
vi.mock("@/lib/email/invite", () => ({ dispatchInviteEmail: vi.fn(async () => ({ ok: true, skipped: false })) }));
vi.mock("@/lib/site", () => ({ publicBaseUrl: () => "https://ascent.example" }));

import { GET, POST, DELETE } from "./route";
import { createInvite, listPendingInvites, revokeInvite } from "@/lib/db";
import { resendInvite } from "@/lib/db/invites";
import { dispatchInviteEmail } from "@/lib/email/invite";

const url = "http://localhost/api/org/invites";
const post = (body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe("/api/org/invites as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the owner gate", async () => {
    expect((await POST(post({ org: "acme", role: "admin", email: "victim@example.test" }))).status).toBe(403);
    expect(createInvite).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("POST refuses %j: no invite is minted and no mail is sent", async (org) => {
    const res = await POST(post({ org, role: "admin", email: "victim@example.test" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(createInvite).not.toHaveBeenCalled();
    expect(dispatchInviteEmail).not.toHaveBeenCalled();
  });

  it("resend refuses the public org", async () => {
    expect((await POST(post({ org: "public", action: "resend", id: "inv_1" }))).status).toBe(403);
    expect(resendInvite).not.toHaveBeenCalled();
  });

  it("DELETE refuses revoking a public-org invite", async () => {
    expect((await DELETE(new Request(`${url}?org=public&id=inv_1`, { method: "DELETE" }))).status).toBe(403);
    expect(revokeInvite).not.toHaveBeenCalled();
  });

  it("GET refuses listing the public org's pending invites (they carry invitee emails)", async () => {
    expect((await GET(new Request(`${url}?org=public`))).status).toBe(403);
    expect(listPendingInvites).not.toHaveBeenCalled();
  });
});
