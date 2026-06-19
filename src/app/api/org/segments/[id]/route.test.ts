// Gate-tests for PATCH/DELETE /api/org/segments/:id — differentiated authz + per-row tenant
// resolution. Unlike the tag routes, this route derives the tenant from the SEGMENT itself via
// getSegmentOrgSlug(id) (404 on unknown id), then gates: PATCH (rename/recolor) is a member-level
// write (requireOrgAccess), DELETE is destructive and requires admin (requireOrgRole(org,"admin")).
// A privilege downgrade of DELETE to a member gate would let any member nuke another team's segment.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getSegmentOrgSlug: vi.fn(async () => "acme"),
  updateSegment: vi.fn(async () => {}),
  deleteSegment: vi.fn(async () => {}),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  requireOrgRole: vi.fn(async () => null),
}));

import { PATCH, DELETE } from "./route";
import { getSegmentOrgSlug, updateSegment, deleteSegment } from "@/lib/db";
import { requireOrgAccess, requireOrgRole } from "@/lib/authz";

const mockOrgSlug = vi.mocked(getSegmentOrgSlug);
const mockUpdate = vi.mocked(updateSegment);
const mockDelete = vi.mocked(deleteSegment);
const mockAccess = vi.mocked(requireOrgAccess);
const mockRole = vi.mocked(requireOrgRole);

function patch(id: string, body: Record<string, unknown> = {}) {
  return PATCH(
    new Request(`http://localhost/api/org/segments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}
function del(id: string) {
  return DELETE(new Request(`http://localhost/api/org/segments/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOrgSlug.mockResolvedValue("acme");
  mockAccess.mockResolvedValue(null);
  mockRole.mockResolvedValue(null);
});

describe("PATCH /api/org/segments/:id — member-gated, segment-derived tenant", () => {
  it("gates on the segment's TRUE owner (getSegmentOrgSlug) with the MEMBER gate, not admin", async () => {
    const res = await patch("seg-1", { name: "Renamed" });
    expect(res.status).toBe(200);
    expect(mockOrgSlug).toHaveBeenCalledWith("seg-1");
    expect(mockAccess).toHaveBeenCalledWith("acme");
    expect(mockRole).not.toHaveBeenCalled(); // PATCH must NOT escalate to an admin gate
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("404s an unknown segment id (getSegmentOrgSlug null) and never writes", async () => {
    mockOrgSlug.mockResolvedValue(null);
    const res = await patch("ghost", { name: "x" });
    expect(res.status).toBe(404);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("DENIES a non-member and never writes", async () => {
    mockAccess.mockResolvedValue(Response.json({ error: "no" }, { status: 403 }) as never);
    const res = await patch("seg-1", { name: "x" });
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("maps P2002 (name clash) to 409 and P2025 (missing) to 404", async () => {
    mockUpdate.mockRejectedValueOnce({ code: "P2002" } as never);
    expect((await patch("seg-1", { name: "dup" })).status).toBe(409);
    mockUpdate.mockRejectedValueOnce({ code: "P2025" } as never);
    expect((await patch("seg-1", { name: "x" })).status).toBe(404);
  });
});

describe("DELETE /api/org/segments/:id — admin-gated destructive op", () => {
  it("requires the ADMIN role on the segment's TRUE owner before deleting", async () => {
    const res = await del("seg-1");
    expect(res.status).toBe(200);
    expect(mockOrgSlug).toHaveBeenCalledWith("seg-1");
    expect(mockRole).toHaveBeenCalledWith("acme", "admin");
    expect(mockAccess).not.toHaveBeenCalled(); // must use the admin gate, not the member gate
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("DENIES a non-admin (privilege downgrade guard) and never deletes", async () => {
    mockRole.mockResolvedValue(
      Response.json({ error: "This action requires the admin role." }, { status: 403 }) as never,
    );
    const res = await del("seg-1");
    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("404s an unknown segment id before any admin check or delete", async () => {
    mockOrgSlug.mockResolvedValue(null);
    const res = await del("ghost");
    expect(res.status).toBe(404);
    expect(mockRole).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
