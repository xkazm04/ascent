// An invite to the shared public org minted before the S5 fix (378743f1) cannot be redeemed (security
// scan 2026-10-07, residue). acceptInvite resolves the org from the TOKEN, so the create-side refusal
// never covered it. Runs the REAL acceptInvite over a faked prisma row.

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
const { setRole, flips } = vi.hoisted(() => ({ setRole: vi.fn(async () => "ok"), flips: vi.fn(async () => ({ count: 1 })) }));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({
    invite: {
      findUnique: vi.fn(async () => ({
        id: "inv_pub",
        status: "pending",
        expiresAt: new Date(Date.now() + 60_000),
        role: "admin",
        githubLogin: null,
        email: null,
        org: { slug: "public" },
      })),
      updateMany: flips,
    },
  }),
}));
vi.mock("@/lib/db/members", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/members")>()),
  getMembershipRole: vi.fn(async () => null),
  setMembershipRole: setRole,
}));
vi.mock("@/lib/db", async () => ({
  isDbConfigured: () => true,
  recordOrgAudit: vi.fn(async () => {}),
  acceptInvite: (await vi.importActual<typeof import("@/lib/db/invites")>("@/lib/db/invites")).acceptInvite,
}));

import { POST } from "./route";
import { recordOrgAudit } from "@/lib/db";

beforeEach(() => vi.clearAllMocks());

describe("POST /api/org/invites/accept with a pre-fix invite to the public org", () => {
  it("answers 409 not_found, grants no role, consumes nothing and audits nothing", async () => {
    const res = await POST(
      new Request("http://localhost/api/org/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "tok" }),
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: "not_found" });
    expect(setRole).not.toHaveBeenCalled();
    expect(flips).not.toHaveBeenCalled();
    expect(recordOrgAudit).not.toHaveBeenCalled();
  });
});
