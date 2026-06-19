// Gate-tests for POST /api/org/segments/:id/repos/bulk — the highest-blast tagging surface (auto
// language segments + the leaderboard bulk bar). Same tenant model as the single route: gate on the
// CLIENT-supplied body.org, but the TRUE owner is resolved inside setRepoSegmentsBulk via its
// { id: segmentId, orgId } filter, which returns -1 (→ 404) when the segment isn't the gated org's.
// A body-smuggled org therefore can't bulk-tag another tenant's segment.

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
  setRepoSegmentsBulk: vi.fn(async () => 0),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
}));

import { POST } from "./route";
import { setRepoSegmentsBulk } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";

const mockBulk = vi.mocked(setRepoSegmentsBulk);
const mockAccess = vi.mocked(requireOrgAccess);

function post(id: string, body: Record<string, unknown>) {
  return POST(
    new Request(`http://localhost/api/org/segments/${id}/repos/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockResolvedValue(null);
  mockBulk.mockResolvedValue(0);
});

describe("POST /api/org/segments/:id/repos/bulk — auth + per-row tenant resolution", () => {
  it("DENIES a caller without access to the body.org — returns the gate Response, never writes", async () => {
    const denial = Response.json({ error: "You don't have access to this organization." }, { status: 403 });
    mockAccess.mockResolvedValue(denial as never);
    const res = await post("seg-B", { org: "A", fullNames: ["victim/repo"], member: true });
    expect(res.status).toBe(403);
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it("400s when fullNames isn't an array — before gate or write", async () => {
    const res = await post("seg-1", { org: "acme", fullNames: "not-an-array" });
    expect(res.status).toBe(400);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it("a body-smuggled org can't bulk-tag another tenant's segment — bulk returns -1 ⇒ 404", async () => {
    mockBulk.mockResolvedValue(-1);
    const res = await post("seg-B", { org: "A", fullNames: ["victim/a", "victim/b"], member: true });
    expect(res.status).toBe(404);
    // The org reaching the db fn is the gated body.org; the { id, orgId } filter rejected the segment.
    expect(mockBulk.mock.calls[0][0]).toBe("A");
    expect(mockBulk.mock.calls[0][1]).toBe("seg-B");
  });

  it("authorized in-org bulk tag returns the exact changed count (default member=true)", async () => {
    mockBulk.mockResolvedValue(3);
    const res = await post("seg-1", { org: "acme", fullNames: ["acme/a", "acme/b", "acme/c"] });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, changed: 3, member: true });
    // member defaults to true (only an explicit false untags), and string filtering is applied.
    expect(mockBulk).toHaveBeenCalledWith("acme", "seg-1", ["acme/a", "acme/b", "acme/c"], true);
  });

  it("filters non-string fullNames and caps the batch before handing to the db fn", async () => {
    await post("seg-1", { org: "acme", fullNames: ["acme/a", 42, null, "acme/b"], member: false });
    expect(mockBulk).toHaveBeenCalledWith("acme", "seg-1", ["acme/a", "acme/b"], false);
  });
});
