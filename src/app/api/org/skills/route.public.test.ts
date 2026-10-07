// Skills cannot be archived on the shared public org (security scan 2026-10-07, finding O12).
// requireOrgRole admits "public" for any signed-in viewer; the single-skill DELETE and the bulk retire
// refuse it before the gate. Runs the REAL @/lib/authz.

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
  archiveOrgSkill: vi.fn(async () => {}),
  getOrgSkill: vi.fn(async () => null),
  getOrgSkillOrgSlug: vi.fn(async (id: string) => (id === "sk-priv" ? "acme" : "public")),
  listOrgSkills: vi.fn(async () => []),
  updateOrgSkill: vi.fn(async () => {}),
}));
vi.mock("@/lib/api-token-auth", () => ({ authorizeOrgApi: vi.fn(), isDenied: vi.fn(), principalLogin: vi.fn() }));
vi.mock("@/lib/org/skill-usage-load", () => ({ getOrgSkillUsage: vi.fn(async () => ({})) }));
vi.mock("@/lib/org/skill-write-gate", () => ({
  skillWriteGate: vi.fn(async () => ({ allowed: true })),
  skillWriteDenial: vi.fn(() => ({ body: {}, status: 403 })),
}));

import { DELETE } from "./[id]/route";
import { POST as retire } from "./retire/route";
import { archiveOrgSkill, listOrgSkills } from "@/lib/db";

const del = (id: string) =>
  DELETE(new Request(`http://localhost/api/org/skills/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
const bulk = (org: string) =>
  retire(
    new Request("http://localhost/api/org/skills/retire", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org, ids: ["sk-1"] }),
    }),
  );

beforeEach(() => vi.clearAllMocks());

describe("/api/org/skills archive routes as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the admin gate", async () => {
    expect((await del("sk-priv")).status).toBe(403);
    expect((await bulk("acme")).status).toBe(403);
    expect(archiveOrgSkill).not.toHaveBeenCalled();
    expect(listOrgSkills).not.toHaveBeenCalled();
  });

  it("DELETE refuses archiving a public-org skill", async () => {
    const res = await del("sk-pub");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(archiveOrgSkill).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("bulk retire refuses %j", async (org) => {
    expect((await bulk(org)).status).toBe(403);
    expect(listOrgSkills).not.toHaveBeenCalled();
    expect(archiveOrgSkill).not.toHaveBeenCalled();
  });
});
