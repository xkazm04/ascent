// The shared public org's AI stance cannot be drafted or published by anyone (security scan
// 2026-10-07, finding O7). requireOrgOwnerPost admits "public" for any signed-in viewer; the route
// refuses it right after the helper returns. Runs the REAL @/lib/authz and @/lib/api/orgPost.

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
  getActiveOrgStance: vi.fn(async () => null),
  getDraftOrgStance: vi.fn(async () => null),
  listOrgStanceVersions: vi.fn(async () => []),
  saveOrgStanceDraft: vi.fn(async () => ({})),
  publishOrgStance: vi.fn(async () => ({})),
}));

import { POST } from "./route";
import { publishOrgStance, saveOrgStanceDraft } from "@/lib/db";

const req = (body: unknown) =>
  new Request("http://localhost/api/org/ai-stance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/org/ai-stance as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the owner gate", async () => {
    expect((await POST(req({ org: "acme", action: "draft", stance: {} }))).status).toBe(403);
    expect(saveOrgStanceDraft).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("refuses drafting and publishing on %j", async (org) => {
    for (const action of ["draft", "publish"]) {
      const res = await POST(req({ org, action, stance: {} }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    }
    expect(saveOrgStanceDraft).not.toHaveBeenCalled();
    expect(publishOrgStance).not.toHaveBeenCalled();
  });
});
