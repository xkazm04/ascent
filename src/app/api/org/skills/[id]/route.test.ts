// Route test for /api/org/skills/[id] PATCH + DELETE (Org Skills Library, Feature 2). Pins the per-row
// authorization the route owns:
//   - the owning org is resolved FROM the skill (getOrgSkillOrgSlug) then authorized — PATCH member,
//     DELETE admin (the privilege boundary; flipping it would let any member archive the org's skills);
//   - both writes additionally require a Team+ plan (403 otherwise, no write);
//   - PATCH forwards a content patch (which drives the version bump) vs an archive-only toggle, and
//     validates category AFTER the gate; DELETE soft-archives (archiveOrgSkill), never hard-deletes;
//   - P2025 -> 404, P2002 -> 409, other -> 500.

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
  mockGetOrgSkillOrgSlug,
  mockGetCreditState,
  mockUpdateOrgSkill,
  mockArchiveOrgSkill,
  mockGetOrgId,
  mockRecordAudit,
  mockRequireOrgAccess,
  mockRequireOrgRole,
  mockGetSession,
} = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetOrgSkillOrgSlug: vi.fn(),
  mockGetCreditState: vi.fn(),
  mockUpdateOrgSkill: vi.fn(),
  mockArchiveOrgSkill: vi.fn(),
  mockGetOrgId: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockRequireOrgAccess: vi.fn(),
  mockRequireOrgRole: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: mockIsDbConfigured,
  getOrgSkillOrgSlug: mockGetOrgSkillOrgSlug,
  getCreditState: mockGetCreditState,
  updateOrgSkill: mockUpdateOrgSkill,
  archiveOrgSkill: mockArchiveOrgSkill,
  getOrgId: mockGetOrgId,
  recordAudit: mockRecordAudit,
  getOrgSkill: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: mockRequireOrgAccess,
  requireOrgRead: vi.fn(),
  requireOrgRole: mockRequireOrgRole,
}));
vi.mock("@/lib/auth", () => ({ getSession: mockGetSession }));

import { PATCH, DELETE } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patchReq = (body: unknown) =>
  new Request("http://t/api/org/skills/s1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockGetOrgSkillOrgSlug.mockResolvedValue("acme");
  mockRequireOrgAccess.mockResolvedValue(null);
  mockRequireOrgRole.mockResolvedValue(null);
  mockGetCreditState.mockResolvedValue({ plan: "team", balance: 0, unlimited: false });
  mockUpdateOrgSkill.mockResolvedValue(undefined);
  mockArchiveOrgSkill.mockResolvedValue(undefined);
  mockGetOrgId.mockResolvedValue("org_acme");
  mockRecordAudit.mockResolvedValue(undefined);
  mockGetSession.mockResolvedValue({ login: "alice" });
});

describe("PATCH /api/org/skills/[id] — per-row gate + plan", () => {
  it("resolves the gate from the skill's TRUE owning org (member-level)", async () => {
    await PATCH(patchReq({ name: "x" }), ctx("s1"));
    expect(mockGetOrgSkillOrgSlug).toHaveBeenCalledWith("s1");
    expect(mockRequireOrgAccess).toHaveBeenCalledWith("acme");
  });

  it("denies a non-member verbatim, no write", async () => {
    mockRequireOrgAccess.mockResolvedValue(Response.json({ error: "no" }, { status: 403 }));
    const res = await PATCH(patchReq({ name: "evil" }), ctx("s1"));
    expect(res.status).toBe(403);
    expect(mockUpdateOrgSkill).not.toHaveBeenCalled();
  });

  it("403 on a non-Team plan, no write", async () => {
    mockGetCreditState.mockResolvedValue({ plan: "pro", balance: 0, unlimited: false });
    const res = await PATCH(patchReq({ name: "x" }), ctx("s1"));
    expect(res.status).toBe(403);
    expect(mockUpdateOrgSkill).not.toHaveBeenCalled();
  });

  it("404 for an unknown id, no gate/write", async () => {
    mockGetOrgSkillOrgSlug.mockResolvedValue(null);
    const res = await PATCH(patchReq({ name: "x" }), ctx("ghost"));
    expect(res.status).toBe(404);
    expect(mockRequireOrgAccess).not.toHaveBeenCalled();
    expect(mockUpdateOrgSkill).not.toHaveBeenCalled();
  });

  it("503 when DB off, before any gate", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await PATCH(patchReq({ name: "x" }), ctx("s1"));
    expect(res.status).toBe(503);
    expect(mockGetOrgSkillOrgSlug).not.toHaveBeenCalled();
  });
});

describe("PATCH — body validation + forwarding", () => {
  it("rejects a bad category with 400 AFTER the gate, no write", async () => {
    const res = await PATCH(patchReq({ category: "bogus" }), ctx("s1"));
    expect(res.status).toBe(400);
    expect(mockRequireOrgAccess).toHaveBeenCalledWith("acme");
    expect(mockUpdateOrgSkill).not.toHaveBeenCalled();
  });

  it("forwards a content patch (drives the version bump downstream)", async () => {
    const res = await PATCH(patchReq({ name: "New", content: "body", category: "testing" }), ctx("s1"));
    expect(res.status).toBe(200);
    const [id, patch] = mockUpdateOrgSkill.mock.calls[0];
    expect(id).toBe("s1");
    expect(patch).toMatchObject({ name: "New", content: "body", category: "testing" });
  });

  it("archive-only toggle forwards `archived` and NO content key", async () => {
    await PATCH(patchReq({ archived: true }), ctx("s1"));
    const [, patch] = mockUpdateOrgSkill.mock.calls[0];
    expect(patch.archived).toBe(true);
    expect(patch.name).toBeUndefined();
    expect(patch.content).toBeUndefined();
    expect(patch.category).toBeUndefined();
  });

  it("coerces non-array tags to undefined", async () => {
    await PATCH(patchReq({ tags: "nope" }), ctx("s1"));
    const [, patch] = mockUpdateOrgSkill.mock.calls[0];
    expect(patch.tags).toBeUndefined();
  });

  it("audits the edit + maps P2025->404, P2002->409, other->500", async () => {
    expect((await PATCH(patchReq({ name: "x" }), ctx("s1"))).status).toBe(200);
    expect(mockRecordAudit.mock.calls[0][0]).toBe("org_skill.updated");
    mockUpdateOrgSkill.mockRejectedValueOnce({ code: "P2025" });
    expect((await PATCH(patchReq({ name: "x" }), ctx("s1"))).status).toBe(404);
    mockUpdateOrgSkill.mockRejectedValueOnce({ code: "P2002" });
    expect((await PATCH(patchReq({ name: "x" }), ctx("s1"))).status).toBe(409);
    mockUpdateOrgSkill.mockRejectedValueOnce(new Error("boom"));
    expect((await PATCH(patchReq({ name: "x" }), ctx("s1"))).status).toBe(500);
  });
});

describe("DELETE /api/org/skills/[id] — admin gate + soft archive", () => {
  it("gates on the ADMIN role for the skill's owning org and soft-archives", async () => {
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), ctx("s1"));
    expect(res.status).toBe(200);
    expect(mockRequireOrgRole).toHaveBeenCalledWith("acme", "admin");
    expect(mockRequireOrgAccess).not.toHaveBeenCalled();
    expect(mockArchiveOrgSkill).toHaveBeenCalledWith("s1");
  });

  it("denies a non-admin verbatim, no archive", async () => {
    mockRequireOrgRole.mockResolvedValue(Response.json({ error: "admin only" }, { status: 403 }));
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), ctx("s1"));
    expect(res.status).toBe(403);
    expect(mockArchiveOrgSkill).not.toHaveBeenCalled();
  });

  it("404 for an unknown id", async () => {
    mockGetOrgSkillOrgSlug.mockResolvedValue(null);
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), ctx("ghost"));
    expect(res.status).toBe(404);
    expect(mockRequireOrgRole).not.toHaveBeenCalled();
  });
});
