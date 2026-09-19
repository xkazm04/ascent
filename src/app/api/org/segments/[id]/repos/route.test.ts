// Gate-tests for POST /api/org/segments/:id/repos (single tag/untag) — the highest-blast IDOR
// surface. The route gates on the CLIENT-supplied body.org (requireOrgAccess), but the TRUE tenant
// resolution happens inside setRepoSegment via its { id: segmentId, orgId } compound filter: a
// member of org A who passes body.org="A" with a segment id owned by B must NOT write — setRepoSegment
// returns false → the route 404s. A body-smuggled org can't tag another tenant's repo.

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
  setRepoSegment: vi.fn(async () => true),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
}));

import { POST } from "./route";
import { setRepoSegment } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";

const mockSet = vi.mocked(setRepoSegment);
const mockAccess = vi.mocked(requireOrgAccess);

function post(id: string, body: Record<string, unknown>) {
  return POST(
    new Request(`http://localhost/api/org/segments/${id}/repos`, {
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
  mockSet.mockResolvedValue(true);
});

describe("POST /api/org/segments/:id/repos — auth + per-row tenant resolution", () => {
  it("DENIES a caller without access to the body.org — returns the gate Response, never writes", async () => {
    const denial = Response.json({ error: "You don't have access to this organization." }, { status: 403 });
    mockAccess.mockResolvedValue(denial as never);
    const res = await post("seg-B", { org: "A", fullName: "victim/repo", member: true });
    expect(res.status).toBe(403);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("400s a missing fullName/org before gate or write", async () => {
    const res = await post("seg-1", { org: "acme" });
    expect(res.status).toBe(400);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("a body-smuggled org can't tag another tenant's segment — setRepoSegment false ⇒ 404", async () => {
    // Caller is a member of A (gate passes for body.org="A"), but seg-B belongs to org B.
    // setRepoSegment resolves the segment's TRUE owner via { id, orgId } and returns false.
    mockSet.mockResolvedValue(false);
    const res = await post("seg-B", { org: "A", fullName: "victim/repo", member: true });
    expect(res.status).toBe(404);
    // The org passed to the db fn is the gated body.org — the compound { id, orgId } filter is the
    // only thing that distinguishes A from B, and it rejected the cross-tenant write.
    expect(mockSet).toHaveBeenCalledWith("A", "seg-B", "victim/repo", true);
  });

  it("authorized in-org tag succeeds with member coerced to boolean", async () => {
    const res = await post("seg-1", { org: "acme", fullName: "acme/app", member: true });
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith("acme", "seg-1", "acme/app", true);
    await expect(res.json()).resolves.toMatchObject({ ok: true, fullName: "acme/app", member: true });
  });

  it("untag (member=false) is forwarded as a false boolean", async () => {
    await post("seg-1", { org: "acme", fullName: "acme/app", member: false });
    expect(mockSet).toHaveBeenCalledWith("acme", "seg-1", "acme/app", false);
  });
});
