// The shared public org's maturity-gate policy cannot be set by anyone (security scan 2026-10-07,
// finding O3). requireOrgOwnerPost admits "public" for any signed-in viewer; the route now refuses it
// right after the helper returns. Runs the REAL @/lib/authz and @/lib/api/orgPost.

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
  getOrgGatePolicy: vi.fn(async () => null),
  setOrgGatePolicy: vi.fn(async () => ({})),
}));

import { POST } from "./route";
import { setOrgGatePolicy } from "@/lib/db";

const req = (body: unknown) =>
  new Request("http://localhost/api/org/gate-policy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/org/gate-policy as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the owner gate", async () => {
    expect((await POST(req({ org: "acme", policy: null }))).status).toBe(403);
    expect(setOrgGatePolicy).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("refuses setting the policy on %j and writes nothing", async (org) => {
    const res = await POST(req({ org, policy: null }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(setOrgGatePolicy).not.toHaveBeenCalled();
  });
});
