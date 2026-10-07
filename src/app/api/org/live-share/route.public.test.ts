// A live-share link cannot be minted for the shared public org (security scan 2026-10-07, finding
// O11). requireOrgRole admits "public" for any signed-in viewer; the route refuses it before the
// gate. Runs the REAL @/lib/authz.

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
vi.mock("@/lib/live-share", () => ({
  liveShareEnabled: () => true,
  normalizeLiveShareView: (v: unknown) => (v === "theater" ? "theater" : "wall"),
  signLiveShareToken: vi.fn(() => ({ token: "t", expiresAt: "2030-01-01" })),
}));

import { POST } from "./route";
import { signLiveShareToken } from "@/lib/live-share";

const req = (org: string) =>
  new Request("http://localhost/api/org/live-share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org, view: "wall" }),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/org/live-share as a signed-in non-member", () => {
  it("control: a private org refuses the stranger", async () => {
    expect((await POST(req("acme"))).status).toBe(403);
    expect(signLiveShareToken).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("refuses minting a link for %j", async (org) => {
    const res = await POST(req(org));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(signLiveShareToken).not.toHaveBeenCalled();
  });
});
