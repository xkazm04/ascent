// The shared public org's retention policy cannot be rewritten by anyone (security scan 2026-10-07,
// finding S2). requireOrgOwnerPost → requireOrgRole("public", "owner") admits any signed-in viewer,
// so before the fix a stranger could shorten the public corpus's retention window (down to the
// floor) and the nightly purge would then delete public scan history on that schedule.

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
vi.mock("@/lib/db/retention", () => ({
  getOrgRetention: vi.fn(async () => ({ retentionMaxScans: null, retentionAuditDays: null })),
  previewOrgRetention: vi.fn(async () => ({ results: [], errors: [] })),
  setOrgRetention: vi.fn(async () => ({ ok: true, view: {} })),
}));

import { POST } from "./route";
import { previewOrgRetention, setOrgRetention } from "@/lib/db/retention";

const policy = { retentionMaxScans: 10, retentionAuditDays: 90, retentionCompact: false, retentionDigestMonths: null };
const post = (body: unknown) =>
  new Request("http://localhost/api/org/retention", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/org/retention as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the owner gate", async () => {
    const res = await post({ org: "acme", ...policy });
    expect((await POST(res)).status).toBe(403);
    expect(setOrgRetention).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("refuses %j with 403 and writes no policy", async (org) => {
    const res = await POST(post({ org, ...policy }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(setOrgRetention).not.toHaveBeenCalled();
  });

  it("refuses a public preview too, before any purge counter runs", async () => {
    const res = await POST(post({ org: "public", ...policy, preview: true }));
    expect(res.status).toBe(403);
    expect(previewOrgRetention).not.toHaveBeenCalled();
  });
});
