// The shared public org's plan cannot be changed by anyone (security scan 2026-10-07, finding O1).
// Runs the REAL @/lib/authz with a signed-in non-member: requireOrgRole("public", "owner") admits that
// caller, so before the fix `{ org: "public", plan: "free" }` reached setOrgPlan.

import { describe, it, expect, vi, beforeEach } from "vitest";

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
  setOrgPlan: vi.fn(async () => true),
  recordOrgAudit: vi.fn(async () => {}),
}));

import { POST } from "./route";
import { setOrgPlan } from "@/lib/db";

const req = (body: unknown) =>
  new Request("http://localhost/api/org/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/org/plan as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the owner gate", async () => {
    expect((await POST(req({ org: "acme", plan: "free" }))).status).toBe(403);
    expect(setOrgPlan).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("refuses a plan change on %j and writes nothing", async (org) => {
    const res = await POST(req({ org, plan: "free" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(setOrgPlan).not.toHaveBeenCalled();
  });
});
