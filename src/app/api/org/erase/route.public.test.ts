// The shared public org cannot be erased by anyone (security scan 2026-10-07, finding S1).
//
// Unlike route.test.ts, this file runs the REAL @/lib/authz: only its data and identity edges are
// stubbed, so the caller is what the finding names, a signed-in account under the login wall with no
// membership anywhere. requireOrgRole("public", "owner") admits that caller (the funnel has no
// owner to check), so before the fix `{ org: "public", confirm: "public" }` reached eraseOrgData and
// destroyed every public repo's scan series.

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
vi.mock("@/lib/db", () => ({
  getInstallationIdForOwner: vi.fn(async () => null),
  isDbConfigured: () => true,
  isPersonalOrg: vi.fn(async () => false),
}));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => false, isOrgAdminViaInstallation: vi.fn() }));
// A non-member: no Membership row anywhere, and every org already has an owner (no bootstrap claim).
vi.mock("@/lib/db/members", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/members")>()),
  getMembershipRole: vi.fn(async () => null),
  orgHasOwner: vi.fn(async () => true),
  ensureOwnerMembership: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/retention", () => ({ ERASE_AUDIT_FORCE_ENV: "ERASE_AUDIT_FORCE", eraseOrgData: vi.fn() }));

import { POST } from "./route";
import { eraseOrgData } from "@/lib/db/retention";

const mockErase = vi.mocked(eraseOrgData);

function req(body: unknown) {
  return new Request("http://localhost/api/org/erase", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockErase.mockResolvedValue({ ok: true, orgSlug: "public", complete: true, audited: true } as never);
});

describe("POST /api/org/erase as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the owner gate", async () => {
    const res = await POST(req({ org: "acme", confirm: "acme" }));
    expect(res.status).toBe(403);
    expect(mockErase).not.toHaveBeenCalled();
  });

  it.each([
    ["org-wide", { org: "public", confirm: "public" }],
    ["case variant", { org: "Public", confirm: "Public" }],
    ["per-repo", { org: "public", confirm: "vercel/next.js", repo: "vercel/next.js" }],
    ["preview", { org: "public", preview: true }],
  ])("refuses the public org (%s) with 403 and erases nothing", async (_label, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(mockErase).not.toHaveBeenCalled();
  });
});
