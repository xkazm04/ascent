// Billing actions cannot be taken in the name of the shared public org (security scan 2026-10-07,
// finding O9). requireOrgRole admits "public" for any signed-in viewer; auto-recharge PUT, checkout
// and the customer portal refuse it before the gate, so no one can change its setting or open a Polar
// session bound to it. Runs the REAL @/lib/authz.

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
  isSameOrigin: () => true,
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
  getOrgId: vi.fn(async () => "org-1"),
  isDbUnavailableError: () => false,
}));
vi.mock("@/lib/db/org-settings", () => ({
  getOrgAutoRecharge: vi.fn(async () => null),
  setOrgAutoRecharge: vi.fn(async () => true),
}));
vi.mock("@/lib/polar", () => ({
  polarEnabled: () => true,
  creditsForProduct: () => 100,
  planForProduct: () => null,
  getPolar: vi.fn(),
  polarCustomerPortalUrl: vi.fn(async () => "https://polar.example/portal"),
}));

import { PUT } from "./autorecharge/route";
import { GET as checkout } from "./checkout/route";
import { GET as portal } from "./portal/route";
import { setOrgAutoRecharge } from "@/lib/db/org-settings";
import { getOrgId } from "@/lib/db";
import { getPolar, polarCustomerPortalUrl } from "@/lib/polar";

const put = (org: string) =>
  new Request("http://localhost/api/billing/autorecharge", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org, enabled: false }),
  });
const get = (path: string, org: string) => new Request(`http://localhost/api/billing/${path}?org=${org}&pack=prod_1`);

beforeEach(() => vi.clearAllMocks());

describe("/api/billing/{autorecharge,checkout,portal} as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the owner gate", async () => {
    expect((await PUT(put("acme"))).status).toBe(403);
    expect((await checkout(get("checkout", "acme"))).status).toBe(403);
    expect((await portal(get("portal", "acme"))).status).toBe(403);
    expect(setOrgAutoRecharge).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("autorecharge PUT refuses %j", async (org) => {
    const res = await PUT(put(org));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(setOrgAutoRecharge).not.toHaveBeenCalled();
  });

  it("checkout refuses minting a Polar session for public", async () => {
    expect((await checkout(get("checkout", "public"))).status).toBe(403);
    expect(getOrgId).not.toHaveBeenCalled();
    expect(getPolar).not.toHaveBeenCalled();
  });

  it("portal refuses opening a Polar portal for public", async () => {
    expect((await portal(get("portal", "public"))).status).toBe(403);
    expect(getOrgId).not.toHaveBeenCalled();
    expect(polarCustomerPortalUrl).not.toHaveBeenCalled();
  });
});
