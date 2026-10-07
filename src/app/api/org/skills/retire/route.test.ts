// Route test for POST /api/org/skills/retire - the bulk retire sweep and its undo.
//
// The rails this pins, in the order they matter:
//   - SAME-ORIGIN FIRST. A cross-origin POST is 403 before the gate and before any read (scan F1).
//   - ADMIN ONLY. A member's call returns 403 and archives nothing (requireOrgRole, session-only,
//     mirroring the single-row DELETE at /api/org/skills/[id]).
//   - ELIGIBILITY IS RE-DERIVED SERVER-SIDE. The route never retires what the client named: it reads
//     the org's own library + usage fold and refuses anything that is not an `abandoned`, hosted row of
//     THIS org. A forged id, a cross-tenant id and a registry-origin id are all `skipped`, never
//     archived, and never counted in `retired`.
//   - ACCOUNTING. `{ retired, skipped: [{ id, reason }] }` so the panel can show the difference rather
//     than its own optimistic number.
//   - RESTORE is the same door with `restore: true`, flipping `archived` back through updateOrgSkill.
//   - One audit row per id, with the EXISTING actions (`org_skill.archived` / `org_skill.updated`),
//     carrying `via: "sweep"` so the sweep's use is countable.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
  },
}));

const {
  mockIsDbConfigured,
  mockListOrgSkills,
  mockGetOrgSkillOrgSlug,
  mockArchiveOrgSkill,
  mockUpdateOrgSkill,
  mockRecordOrgAudit,
  mockGetCreditState,
  mockIsPersonalOrg,
  mockGetPersonalUsage,
  mockRequireOrgRole,
  mockResolveViewerLogin,
  mockGetOrgSkillUsage,
  xo,
} = vi.hoisted(() => ({
  xo: { sameOrigin: true },
  mockIsDbConfigured: vi.fn(),
  mockListOrgSkills: vi.fn(),
  mockGetOrgSkillOrgSlug: vi.fn(),
  mockArchiveOrgSkill: vi.fn(),
  mockUpdateOrgSkill: vi.fn(),
  mockRecordOrgAudit: vi.fn(),
  mockGetCreditState: vi.fn(),
  mockIsPersonalOrg: vi.fn(),
  mockGetPersonalUsage: vi.fn(),
  mockRequireOrgRole: vi.fn(),
  mockResolveViewerLogin: vi.fn(),
  mockGetOrgSkillUsage: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: mockIsDbConfigured,
  listOrgSkills: mockListOrgSkills,
  getOrgSkillOrgSlug: mockGetOrgSkillOrgSlug,
  archiveOrgSkill: mockArchiveOrgSkill,
  updateOrgSkill: mockUpdateOrgSkill,
  recordOrgAudit: mockRecordOrgAudit,
  getCreditState: mockGetCreditState,
  isPersonalOrg: mockIsPersonalOrg,
  getPersonalUsage: mockGetPersonalUsage,
  PERSONAL_SKILL_LIMIT: 10,
}));
vi.mock("@/lib/authz", () => ({ refusePublicOrgAdmin: () => null, requireOrgRole: mockRequireOrgRole }));
vi.mock("@/lib/auth", () => ({
  requireSameOrigin: () =>
    xo.sameOrigin ? null : new Response(JSON.stringify({ error: "Cross-origin request rejected." }), { status: 403 }),
}));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: mockResolveViewerLogin }));
vi.mock("@/lib/org/skill-usage-load", () => ({ getOrgSkillUsage: mockGetOrgSkillUsage }));

import { POST } from "./route";

const req = (body: unknown) =>
  new Request("http://t/api/org/skills/retire", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

function row(id: string, origin: "hosted" | "registry" = "hosted") {
  return { id, name: id, origin, registryPath: origin === "registry" ? `skills/${id}/SKILL.md` : null };
}
function use(id: string, state: string) {
  return { skillId: id, state, verdict: state === "active" ? "active" : "dormant", windowDays: 30 };
}

beforeEach(() => {
  vi.clearAllMocks();
  xo.sameOrigin = true;
  mockIsDbConfigured.mockReturnValue(true);
  mockRequireOrgRole.mockResolvedValue(null);
  mockResolveViewerLogin.mockResolvedValue("admin1");
  mockGetCreditState.mockResolvedValue({ plan: "team" });
  mockIsPersonalOrg.mockResolvedValue(false);
  mockArchiveOrgSkill.mockResolvedValue(undefined);
  mockUpdateOrgSkill.mockResolvedValue(undefined);
  mockRecordOrgAudit.mockResolvedValue(undefined);
  mockListOrgSkills.mockResolvedValue([row("a1"), row("a2"), row("a3"), row("u1"), row("r1", "registry")]);
  mockGetOrgSkillUsage.mockResolvedValue({
    a1: use("a1", "abandoned"),
    a2: use("a2", "abandoned"),
    a3: use("a3", "abandoned"),
    u1: use("u1", "unused"),
    r1: use("r1", "abandoned"),
  });
});

describe("POST /api/org/skills/retire - the gate", () => {
  it("refuses a cross-origin POST before the admin gate and before any read (scan F1)", async () => {
    xo.sameOrigin = false;
    const res = await POST(req({ org: "acme", ids: ["a1", "a2"] }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Cross-origin request rejected.");
    expect(mockRequireOrgRole).not.toHaveBeenCalled();
    expect(mockListOrgSkills).not.toHaveBeenCalled();
    expect(mockArchiveOrgSkill).not.toHaveBeenCalled();
  });

  it("archives exactly the named eligible ids for an admin", async () => {
    const res = await POST(req({ org: "acme", ids: ["a1", "a3"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ retired: 2, skipped: [] });
    expect(mockArchiveOrgSkill.mock.calls.map((c) => c[0])).toEqual(["a1", "a3"]);
  });

  it("refuses a non-admin member and archives nothing", async () => {
    mockRequireOrgRole.mockResolvedValue(new Response(JSON.stringify({ error: "Admins only." }), { status: 403 }));
    const res = await POST(req({ org: "acme", ids: ["a1", "a2"] }));
    expect(res.status).toBe(403);
    expect(mockArchiveOrgSkill).not.toHaveBeenCalled();
    expect(mockRecordOrgAudit).not.toHaveBeenCalled();
  });

  it("gates on the org from the BODY, so the admin check runs before any read", async () => {
    await POST(req({ org: "acme", ids: ["a1"] }));
    expect(mockRequireOrgRole).toHaveBeenCalledWith("acme", "admin");
  });

  it("needs an org and a non-empty id list", async () => {
    expect((await POST(req({ ids: ["a1"] }))).status).toBe(400);
    expect((await POST(req({ org: "acme", ids: [] }))).status).toBe(400);
    expect((await POST(req({ org: "acme" }))).status).toBe(400);
    expect(mockArchiveOrgSkill).not.toHaveBeenCalled();
  });

  it("503s with no database", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect((await POST(req({ org: "acme", ids: ["a1"] }))).status).toBe(503);
  });
});

describe("POST /api/org/skills/retire - eligibility is re-derived, never trusted", () => {
  it("skips an id that is not in this org's library (a forged or cross-tenant id)", async () => {
    const res = await POST(req({ org: "acme", ids: ["a1", "other-org-skill"] }));
    const body = await res.json();
    expect(body.retired).toBe(1);
    expect(body.skipped).toEqual([{ id: "other-org-skill", reason: "not-in-library" }]);
    expect(mockArchiveOrgSkill.mock.calls.map((c) => c[0])).toEqual(["a1"]);
  });

  it("skips an id the usage fold does not call abandoned, however the client labelled it", async () => {
    const res = await POST(req({ org: "acme", ids: ["u1"] }));
    const body = await res.json();
    expect(body).toEqual({ retired: 0, skipped: [{ id: "u1", reason: "not-a-prune-candidate" }] });
    expect(mockArchiveOrgSkill).not.toHaveBeenCalled();
  });

  it("skips a registry-origin id and names it", async () => {
    const res = await POST(req({ org: "acme", ids: ["r1", "a1"] }));
    const body = await res.json();
    expect(body.retired).toBe(1);
    expect(body.skipped).toEqual([{ id: "r1", reason: "registry-origin" }]);
  });

  it("de-duplicates a repeated id rather than archiving it twice", async () => {
    const res = await POST(req({ org: "acme", ids: ["a1", "a1"] }));
    expect((await res.json()).retired).toBe(1);
    expect(mockArchiveOrgSkill).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/org/skills/retire - audit", () => {
  it("writes one org_skill.archived row per retired id, carrying via: sweep", async () => {
    await POST(req({ org: "acme", ids: ["a1", "a2"] }));
    expect(mockRecordOrgAudit).toHaveBeenCalledTimes(2);
    const [action, org, detail, actor] = mockRecordOrgAudit.mock.calls[0];
    expect(action).toBe("org_skill.archived");
    expect(org).toBe("acme");
    expect(detail).toMatchObject({ skillId: "a1", via: "sweep" });
    expect(actor).toBe("admin1");
  });

  it("writes no audit row for a skipped id", async () => {
    await POST(req({ org: "acme", ids: ["u1", "r1"] }));
    expect(mockRecordOrgAudit).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/skills/retire - restore", () => {
  beforeEach(() => {
    mockGetOrgSkillOrgSlug.mockImplementation(async (id: string) => (id === "foreign" ? "other" : "acme"));
  });

  it("flips archived back to false for the named ids", async () => {
    const res = await POST(req({ org: "acme", ids: ["a1", "a2"], restore: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ restored: 2, skipped: [] });
    expect(mockUpdateOrgSkill).toHaveBeenCalledWith("a1", { archived: false });
    expect(mockUpdateOrgSkill).toHaveBeenCalledWith("a2", { archived: false });
    expect(mockArchiveOrgSkill).not.toHaveBeenCalled();
  });

  it("audits a restore as org_skill.updated with archived: false", async () => {
    await POST(req({ org: "acme", ids: ["a1"], restore: true }));
    const [action, org, detail] = mockRecordOrgAudit.mock.calls[0];
    expect(action).toBe("org_skill.updated");
    expect(org).toBe("acme");
    expect(detail).toMatchObject({ skillId: "a1", archived: false, via: "sweep" });
  });

  it("skips an id owned by another org instead of restoring it", async () => {
    const res = await POST(req({ org: "acme", ids: ["a1", "foreign"], restore: true }));
    const body = await res.json();
    expect(body.restored).toBe(1);
    expect(body.skipped).toEqual([{ id: "foreign", reason: "not-in-library" }]);
    expect(mockUpdateOrgSkill).toHaveBeenCalledTimes(1);
  });

  it("is admin-gated too", async () => {
    mockRequireOrgRole.mockResolvedValue(new Response("{}", { status: 403 }));
    expect((await POST(req({ org: "acme", ids: ["a1"], restore: true }))).status).toBe(403);
    expect(mockUpdateOrgSkill).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/skills/retire - entitlement", () => {
  it("passes through the ONE skills write-door decision (402 at the personal cap is NOT this door)", async () => {
    mockGetCreditState.mockResolvedValue({ plan: "free" });
    mockIsPersonalOrg.mockResolvedValue(false);
    const res = await POST(req({ org: "acme", ids: ["a1"] }));
    expect(res.status).toBe(403);
    expect((await res.json()).decision).toBe("plan-required");
    expect(mockArchiveOrgSkill).not.toHaveBeenCalled();
  });

  it("a personal workspace AT its cap may still retire - archiving shrinks the library", async () => {
    mockGetCreditState.mockResolvedValue({ plan: "free" });
    mockIsPersonalOrg.mockResolvedValue(true);
    mockGetPersonalUsage.mockResolvedValue({ skills: { used: 10 } });
    const res = await POST(req({ org: "acme", ids: ["a1"] }));
    expect(res.status).toBe(200);
    expect((await res.json()).retired).toBe(1);
  });
});
