// Org API tokens cannot be listed, minted or revoked on the shared public org (security scan
// 2026-10-07, finding S7). These routes gate on requireOrgAccess, which admits PUBLIC_ORG for any
// signed-in viewer (the free funnel, by design). That is right for scanning and wrong for tokens: a
// stranger could list everyone's public-org tokens, revoke them, or mint one that speaks for the
// public org's Skills Library. requireOrgAccess itself is unchanged; these routes opt out of public.

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
  isSkillTokenScope: (s: string) => s === "skills:read" || s === "skills:write",
  SKILL_TOKEN_SCOPES: ["skills:read", "skills:write"],
  listOrgApiTokens: vi.fn(async () => [{ id: "tok_1", name: "someone-elses-ci" }]),
  createOrgApiToken: vi.fn(async () => ({ token: "raw", summary: { id: "tok_2", name: "mine", scopes: [] } })),
  revokeOrgApiToken: vi.fn(async () => true),
  recordOrgAudit: vi.fn(async () => {}),
}));

import { GET, POST } from "./route";
import { DELETE } from "./[id]/route";
import { createOrgApiToken, listOrgApiTokens, revokeOrgApiToken } from "@/lib/db";

const url = "http://localhost/api/org/tokens";
const post = (body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const del = (org: string) =>
  DELETE(new Request(`${url}/tok_1?org=${org}`, { method: "DELETE" }), { params: Promise.resolve({ id: "tok_1" }) });

beforeEach(() => vi.clearAllMocks());

describe("/api/org/tokens as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the member gate", async () => {
    expect((await GET(new Request(`${url}?org=acme`))).status).toBe(403);
    expect((await POST(post({ org: "acme", name: "x" }))).status).toBe(403);
    expect((await del("acme")).status).toBe(403);
    expect(revokeOrgApiToken).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("DELETE refuses revoking a token on %j", async (org) => {
    const res = await del(org);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(revokeOrgApiToken).not.toHaveBeenCalled();
  });

  it("POST refuses minting a public-org token", async () => {
    expect((await POST(post({ org: "public", name: "mine", scopes: ["skills:write"] }))).status).toBe(403);
    expect(createOrgApiToken).not.toHaveBeenCalled();
  });

  it("GET refuses listing the public org's tokens", async () => {
    expect((await GET(new Request(`${url}?org=public`))).status).toBe(403);
    expect(listOrgApiTokens).not.toHaveBeenCalled();
  });
});
