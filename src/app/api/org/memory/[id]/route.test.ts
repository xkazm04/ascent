// Route test for /api/org/memory/[id] — the AUTHOR gate on writes (design doc §4.5).
//
// REGRESSION (explorer, 2026-08-29): GET enforced "another author's private scratch is not readable
// just because its id was guessed" and every db read composed visibilityScope(viewer) — but the write
// path did not. `gateWrite` resolved the org, required a role, checked the plan and stopped, while
// `updateOrgMemory` is keyed on id alone. A member who got a 404 READING a colleague's private memory
// could still PATCH it: overwrite the content, or set visibility:"shared" and publish it. Read-scoping
// without write-scoping is a display rule, not a privacy rule.
//
// The gate answers 404, not 403, on purpose: a caller who is not allowed to know the row exists must
// not learn that it does from the write path either.

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
  mockGetOrgMemoryOrgSlug,
  mockGetOrgMemory,
  mockGetCreditState,
  mockWorkspaceAllowsMemory,
  mockUpdateOrgMemory,
  mockArchiveOrgMemory,
  mockRecordAudit,
  mockGetOrgId,
  mockRequireOrgAccess,
  mockRequireOrgRole,
  mockRequireOrgRead,
  mockResolveViewerLogin,
} = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetOrgMemoryOrgSlug: vi.fn(),
  mockGetOrgMemory: vi.fn(),
  mockGetCreditState: vi.fn(),
  mockWorkspaceAllowsMemory: vi.fn(),
  mockUpdateOrgMemory: vi.fn(),
  mockArchiveOrgMemory: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockGetOrgId: vi.fn(),
  mockRequireOrgAccess: vi.fn(),
  mockRequireOrgRole: vi.fn(),
  mockRequireOrgRead: vi.fn(),
  mockResolveViewerLogin: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: mockIsDbConfigured,
  getOrgMemoryOrgSlug: mockGetOrgMemoryOrgSlug,
  getOrgMemory: mockGetOrgMemory,
  getCreditState: mockGetCreditState,
  workspaceAllowsMemory: mockWorkspaceAllowsMemory,
  updateOrgMemory: mockUpdateOrgMemory,
  archiveOrgMemory: mockArchiveOrgMemory,
  recordAudit: mockRecordAudit,
  getOrgId: mockGetOrgId,
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: mockRequireOrgAccess,
  requireOrgRole: mockRequireOrgRole,
  requireOrgRead: mockRequireOrgRead,
}));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: mockResolveViewerLogin }));

import { DELETE, GET, PATCH } from "./route";

const ctx = { params: Promise.resolve({ id: "mem_1" }) };
const patch = (body: unknown) =>
  new Request("http://localhost/api/org/memory/mem_1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

const SHARED = { id: "mem_1", visibility: "shared", createdBy: "bob", content: "x" };
const BOBS_PRIVATE = { id: "mem_1", visibility: "private", createdBy: "bob", content: "x" };

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockGetOrgMemoryOrgSlug.mockResolvedValue("acme");
  mockRequireOrgAccess.mockResolvedValue(null);
  mockRequireOrgRole.mockResolvedValue(null);
  mockRequireOrgRead.mockResolvedValue(null);
  mockWorkspaceAllowsMemory.mockResolvedValue(true);
  mockGetCreditState.mockResolvedValue({ plan: "team" });
  mockGetOrgId.mockResolvedValue("org_acme");
  mockResolveViewerLogin.mockResolvedValue("alice");
});

describe("PATCH /api/org/memory/[id] — the author gate", () => {
  it("refuses another author's PRIVATE memory with 404, and writes nothing", async () => {
    mockGetOrgMemory.mockResolvedValue(BOBS_PRIVATE);
    const res = await PATCH(patch({ content: "rewritten" }), ctx);
    expect(res.status).toBe(404);
    expect(mockUpdateOrgMemory).not.toHaveBeenCalled();
  });

  it("refuses the visibility flip that would PUBLISH another author's private memory", async () => {
    mockGetOrgMemory.mockResolvedValue(BOBS_PRIVATE);
    const res = await PATCH(patch({ visibility: "shared" }), ctx);
    expect(res.status).toBe(404);
    expect(mockUpdateOrgMemory).not.toHaveBeenCalled();
  });

  it("lets the AUTHOR edit their own private memory", async () => {
    mockGetOrgMemory.mockResolvedValue({ ...BOBS_PRIVATE, createdBy: "alice" });
    const res = await PATCH(patch({ content: "mine to edit" }), ctx);
    expect(res.status).toBe(200);
    expect(mockUpdateOrgMemory).toHaveBeenCalledWith("mem_1", expect.objectContaining({ content: "mine to edit" }));
  });

  it("leaves SHARED memories editable by any member — the gate is about private scratch only", async () => {
    mockGetOrgMemory.mockResolvedValue(SHARED);
    const res = await PATCH(patch({ content: "collaborative" }), ctx);
    expect(res.status).toBe(200);
    expect(mockUpdateOrgMemory).toHaveBeenCalled();
  });
});

describe("DELETE /api/org/memory/[id] — the author gate binds admins too", () => {
  it("refuses to archive another author's private memory", async () => {
    mockGetOrgMemory.mockResolvedValue(BOBS_PRIVATE);
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), ctx);
    expect(res.status).toBe(404);
    expect(mockArchiveOrgMemory).not.toHaveBeenCalled();
  });

  it("archives a shared memory for an admin", async () => {
    mockGetOrgMemory.mockResolvedValue(SHARED);
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), ctx);
    expect(res.status).toBe(200);
    expect(mockArchiveOrgMemory).toHaveBeenCalledWith("mem_1");
  });
});

describe("GET /api/org/memory/[id] — unchanged, and the reference the writes now match", () => {
  it("404s another author's private memory", async () => {
    mockGetOrgMemory.mockResolvedValue(BOBS_PRIVATE);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(404);
  });

  it("returns a shared one", async () => {
    mockGetOrgMemory.mockResolvedValue(SHARED);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
  });
});
