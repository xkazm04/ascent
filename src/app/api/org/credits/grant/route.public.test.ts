// The shared public org's credit balance cannot be minted or debited by anyone (security scan
// 2026-10-07, finding S6). The route already sits behind creditGrantsEnabled() (never on in
// production), and is stubbed on here, as on a dev/demo/staging deployment with the flag set: there
// requireOrgRole("public", "owner") admitted any signed-in viewer, so a stranger could move the
// public funnel's balance by up to the lifetime cap.

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
  getCreditState: vi.fn(async () => ({ balance: 0, plan: "free", unlimited: false })),
  grantCredits: vi.fn(async () => 100_000),
}));
vi.mock("@/lib/db/credits", () => ({ sumManualGrants: vi.fn(async () => 0) }));
vi.mock("@/lib/env", async (orig) => ({ ...(await orig<typeof import("@/lib/env")>()), creditGrantsEnabled: () => true }));

import { POST } from "./route";
import { grantCredits } from "@/lib/db";

const post = (body: unknown) =>
  new Request("http://localhost/api/org/credits/grant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/org/credits/grant as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the owner gate", async () => {
    expect((await POST(post({ org: "acme", amount: 100_000 }))).status).toBe(403);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("refuses %j with 403 and moves no credits", async (org) => {
    const res = await POST(post({ org, amount: 100_000 }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(grantCredits).not.toHaveBeenCalled();
  });
});
