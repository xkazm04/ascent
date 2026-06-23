// Route test for /api/org/playbooks/[id] PATCH + DELETE (Test Mastery — Playbooks, medium #5).
// Pins two privilege/data-integrity invariants the route owns and nothing else covers:
//
//   1. The per-row org gate: the owning org is resolved FROM the playbook (getPlaybookOrgSlug),
//      then authorized. A non-member is denied (the gate Response is returned verbatim) and NO
//      write happens. PATCH is member-gated (requireOrgAccess); DELETE is admin-gated
//      (requireOrgRole(org, "admin")) — we assert the *admin* arg, since flipping it to member
//      would let any member destroy the org's standards. An unknown id (null org slug) -> 404,
//      again with no write.
//   2. The version-bump branch the route drives: a CONTENT edit forwards the content patch
//      (title/dimId/summary/steps) to updatePlaybook (which issues version:{increment:1}), while
//      an archive-only toggle forwards only `archived` and NO content key — so the change-history
//      version advances on content edits but not on archive toggles.
//
// Also pins body validation (bad dimId -> 400) firing AFTER the gate, and the P2025->404 /
// other-error->500 mapping. Route harness: NextResponse is faked as a Response subclass so the
// handlers' NextResponse.json(...) is readable here; authz + db + auth are fully mocked. Dynamic
// params arrive as `{ params: Promise.resolve({ id }) }`, mirroring Next 16's async route ctx.

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- next/server fake: a real Response subclass with a static json() that stamps status. ----
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
  mockGetPlaybookOrgSlug,
  mockUpdatePlaybook,
  mockDeletePlaybook,
  mockRecordAudit,
  mockRequireOrgAccess,
  mockRequireOrgRole,
  mockGetSession,
} = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPlaybookOrgSlug: vi.fn(),
  mockUpdatePlaybook: vi.fn(),
  mockDeletePlaybook: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockRequireOrgAccess: vi.fn(),
  mockRequireOrgRole: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPlaybookOrgSlug: mockGetPlaybookOrgSlug,
  updatePlaybook: mockUpdatePlaybook,
  deletePlaybook: mockDeletePlaybook,
  // The route now audits via the consolidated recordOrgAudit (resolve-orgId-then-record).
  recordOrgAudit: mockRecordAudit,
}));

vi.mock("@/lib/authz", () => ({
  requireOrgAccess: mockRequireOrgAccess,
  requireOrgRole: mockRequireOrgRole,
}));

// The route's per-row gate is the shared resolvePlaybookOrg helper, which reads getPlaybookOrgSlug /
// isDbConfigured / requireOrgAccess|Role from the mocked @/lib/db + @/lib/authz above — so it exercises
// the real guard logic against these mocks. Mock @/lib/org/playbook-gate is therefore NOT stubbed.

vi.mock("@/lib/auth", () => ({
  getSession: mockGetSession,
}));

import { PATCH, DELETE } from "./route";

// Build a Next-style route ctx whose params resolve to { id }.
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
// Build a PATCH Request whose json() yields `body`.
const patchReq = (body: unknown) =>
  new Request("http://t/api/org/playbooks/p1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path wiring: DB on, playbook owned by "acme", gates allow, session present.
  mockIsDbConfigured.mockReturnValue(true);
  mockGetPlaybookOrgSlug.mockResolvedValue("acme");
  mockRequireOrgAccess.mockResolvedValue(null); // member access granted
  mockRequireOrgRole.mockResolvedValue(null); // admin access granted
  mockUpdatePlaybook.mockResolvedValue(undefined);
  mockDeletePlaybook.mockResolvedValue(undefined);
  mockRecordAudit.mockResolvedValue(undefined);
  mockGetSession.mockResolvedValue({ login: "alice" });
});

describe("PATCH /api/org/playbooks/[id] — per-row gate", () => {
  it("resolves the gate from the playbook's TRUE owning org", async () => {
    mockGetPlaybookOrgSlug.mockResolvedValue("acme");
    await PATCH(patchReq({ title: "x" }), ctx("p1"));
    expect(mockGetPlaybookOrgSlug).toHaveBeenCalledWith("p1");
    expect(mockRequireOrgAccess).toHaveBeenCalledWith("acme");
  });

  it("denies a NON-MEMBER and performs NO write (gate 403 returned verbatim)", async () => {
    mockRequireOrgAccess.mockResolvedValue(
      Response.json({ error: "You don't have access to this organization." }, { status: 403 }),
    );
    const res = await PATCH(patchReq({ title: "evil" }), ctx("p1"));
    expect(res.status).toBe(403);
    expect(mockUpdatePlaybook).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown id and never writes", async () => {
    mockGetPlaybookOrgSlug.mockResolvedValue(null);
    const res = await PATCH(patchReq({ title: "x" }), ctx("ghost"));
    expect(res.status).toBe(404);
    expect(mockRequireOrgAccess).not.toHaveBeenCalled();
    expect(mockUpdatePlaybook).not.toHaveBeenCalled();
  });

  it("returns 503 when the DB is not configured (before any gate/write)", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await PATCH(patchReq({ title: "x" }), ctx("p1"));
    expect(res.status).toBe(503);
    expect(mockGetPlaybookOrgSlug).not.toHaveBeenCalled();
    expect(mockUpdatePlaybook).not.toHaveBeenCalled();
  });
});

describe("PATCH — body validation fires AFTER the gate", () => {
  it("rejects a bad dimId with 400 and does not write", async () => {
    const res = await PATCH(patchReq({ dimId: "X9" }), ctx("p1"));
    expect(res.status).toBe(400);
    // gate ran first...
    expect(mockRequireOrgAccess).toHaveBeenCalledWith("acme");
    // ...but no write on invalid input.
    expect(mockUpdatePlaybook).not.toHaveBeenCalled();
  });

  it("does NOT validate dimId when the caller is unauthorized (gate wins)", async () => {
    mockRequireOrgAccess.mockResolvedValue(Response.json({ error: "no" }, { status: 403 }));
    const res = await PATCH(patchReq({ dimId: "X9" }), ctx("p1"));
    // Gate's 403 wins over the would-be 400 — denial precedes validation.
    expect(res.status).toBe(403);
    expect(mockUpdatePlaybook).not.toHaveBeenCalled();
  });
});

describe("PATCH — version-bump branch (content edit vs archive toggle)", () => {
  it("forwards a CONTENT patch (title/dimId/summary/steps) that drives version:{increment}", async () => {
    const res = await PATCH(
      patchReq({ title: "New", dimId: "D5", summary: "s", steps: ["a", "b"] }),
      ctx("p1"),
    );
    expect(res.status).toBe(200);
    expect(mockUpdatePlaybook).toHaveBeenCalledTimes(1);
    const [id, patch] = mockUpdatePlaybook.mock.calls[0];
    expect(id).toBe("p1");
    expect(patch).toMatchObject({ title: "New", dimId: "D5", summary: "s", steps: ["a", "b"] });
  });

  it("archive-only toggle forwards `archived` and NO content key (no version bump)", async () => {
    await PATCH(patchReq({ archived: true }), ctx("p1"));
    expect(mockUpdatePlaybook).toHaveBeenCalledTimes(1);
    const [, patch] = mockUpdatePlaybook.mock.calls[0];
    expect(patch.archived).toBe(true);
    expect(patch.title).toBeUndefined();
    expect(patch.dimId).toBeUndefined();
    expect(patch.summary).toBeUndefined();
    expect(patch.steps).toBeUndefined();
  });

  it("coerces a non-array steps to undefined so it is not persisted as junk", async () => {
    await PATCH(patchReq({ steps: "not-an-array" }), ctx("p1"));
    const [, patch] = mockUpdatePlaybook.mock.calls[0];
    expect(patch.steps).toBeUndefined();
  });

  it("audits the edit on success", async () => {
    const res = await PATCH(patchReq({ title: "x" }), ctx("p1"));
    expect(res.status).toBe(200);
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit.mock.calls[0][0]).toBe("playbook.updated");
  });
});

describe("PATCH — error mapping", () => {
  it("maps a P2025 (missing row) to 404", async () => {
    mockUpdatePlaybook.mockRejectedValue({ code: "P2025" });
    const res = await PATCH(patchReq({ title: "x" }), ctx("p1"));
    expect(res.status).toBe(404);
  });

  it("maps any other error to 500", async () => {
    mockUpdatePlaybook.mockRejectedValue(new Error("boom"));
    const res = await PATCH(patchReq({ title: "x" }), ctx("p1"));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/org/playbooks/[id] — admin gate + per-row", () => {
  it("gates on the ADMIN role for the playbook's owning org", async () => {
    await DELETE(new Request("http://t", { method: "DELETE" }), ctx("p1"));
    expect(mockGetPlaybookOrgSlug).toHaveBeenCalledWith("p1");
    // The privilege boundary: admin, not member.
    expect(mockRequireOrgRole).toHaveBeenCalledWith("acme", "admin");
    expect(mockRequireOrgAccess).not.toHaveBeenCalled();
  });

  it("denies a non-admin member and performs NO delete (gate 403 verbatim)", async () => {
    mockRequireOrgRole.mockResolvedValue(
      Response.json({ error: "This action requires the admin role in this organization." }, { status: 403 }),
    );
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), ctx("p1"));
    expect(res.status).toBe(403);
    expect(mockDeletePlaybook).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown id and never deletes", async () => {
    mockGetPlaybookOrgSlug.mockResolvedValue(null);
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), ctx("ghost"));
    expect(res.status).toBe(404);
    expect(mockRequireOrgRole).not.toHaveBeenCalled();
    expect(mockDeletePlaybook).not.toHaveBeenCalled();
  });

  it("deletes once on the happy path", async () => {
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), ctx("p1"));
    expect(res.status).toBe(200);
    expect(mockDeletePlaybook).toHaveBeenCalledWith("p1");
  });

  it("maps P2025 to 404 and other errors to 500", async () => {
    mockDeletePlaybook.mockRejectedValueOnce({ code: "P2025" });
    expect((await DELETE(new Request("http://t", { method: "DELETE" }), ctx("p1"))).status).toBe(404);
    mockDeletePlaybook.mockRejectedValueOnce(new Error("boom"));
    expect((await DELETE(new Request("http://t", { method: "DELETE" }), ctx("p1"))).status).toBe(500);
  });
});
