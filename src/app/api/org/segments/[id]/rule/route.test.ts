// Gate + contract tests for /api/org/segments/:id/rule — the segment's DECLARED membership and the
// explicit convergence that applies it.
//
// This is an `[id]` route, so it resolves the tenant from the ROW (getSegmentOrgSlug) and gates that,
// never a caller-supplied org beside a caller-supplied id — the resolve-then-gate half of
// src/app/api/org/id-routes-gated.test.ts, exactly as the sibling PATCH/DELETE route does.
//
// The apply is audited with COUNTS ONLY (`segment.rule_applied`): a converged segment can name
// hundreds of repos, and the bulk route already established that the trail never stores the list.

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
  updateSegment: vi.fn(async () => true),
  applySegmentRule: vi.fn(async () => ({ added: 5, removed: 0 })),
  recordOrgAudit: vi.fn(async () => true),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  requireOrgRole: vi.fn(async () => null),
}));
vi.mock("@/lib/access", () => ({
  resolveViewerLogin: vi.fn(async () => "alice"),
}));

import { POST, PUT } from "./route";
import { applySegmentRule, getSegmentOrgSlug, recordOrgAudit, updateSegment } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";

const mockOrgSlug = vi.mocked(getSegmentOrgSlug);
const mockUpdate = vi.mocked(updateSegment);
const mockApply = vi.mocked(applySegmentRule);
const mockAudit = vi.mocked(recordOrgAudit);
const mockAccess = vi.mocked(requireOrgAccess);

const req = (id: string, method: string, body?: Record<string, unknown>) =>
  new Request(`http://localhost/api/org/segments/${id}/rule`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const post = (id: string, body?: Record<string, unknown>) => POST(req(id, "POST", body), { params: Promise.resolve({ id }) });
const put = (id: string, body?: Record<string, unknown>) => PUT(req(id, "PUT", body), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockOrgSlug.mockResolvedValue("acme");
  mockAccess.mockResolvedValue(null);
  mockUpdate.mockResolvedValue(true);
  mockApply.mockResolvedValue({ added: 5, removed: 0 });
});

describe("POST /api/org/segments/:id/rule — declare and converge", () => {
  it("stores the declared rule for a member of the OWNING org and applies it", async () => {
    const res = await post("seg-1", { kind: "language", values: ["Python"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, added: 5, removed: 0 });
    expect(mockOrgSlug).toHaveBeenCalledWith("seg-1");
    expect(mockAccess).toHaveBeenCalledWith("acme");
    // The rule is PERSISTED, which is the whole point: a one-shot bulk tag stored nothing.
    expect(mockUpdate).toHaveBeenCalledWith("seg-1", { rule: { kind: "language", values: ["Python"] } });
    expect(mockApply).toHaveBeenCalledWith("acme", "seg-1");
  });

  it("applies the STORED rule when the body carries none", async () => {
    const res = await post("seg-1", {});
    expect(res.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockApply).toHaveBeenCalledWith("acme", "seg-1");
  });

  it("404s a segment owned by ANOTHER org (resolve-then-gate: the id never names its own tenant)", async () => {
    mockOrgSlug.mockResolvedValue(null); // getSegmentOrgSlug sees no row for this caller's reach
    const res = await post("seg-of-org-b", { kind: "language", values: ["Python"] });
    expect(res.status).toBe(404);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("propagates the authz denial without writing", async () => {
    mockAccess.mockResolvedValue(new Response("no", { status: 403 }));
    const res = await post("seg-1", { kind: "language", values: ["Python"] });
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("400s a malformed rule instead of storing one that matches nothing", async () => {
    const res = await post("seg-1", { kind: "stars", values: ["x"] });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("writes exactly ONE segment.rule_applied audit row carrying counts and no repo list", async () => {
    mockApply.mockResolvedValue({ added: 3, removed: 2 });
    await post("seg-1", { kind: "language", values: ["Python"] });
    expect(mockAudit).toHaveBeenCalledTimes(1);
    const [action, org, meta] = mockAudit.mock.calls[0]!;
    expect(action).toBe("segment.rule_applied");
    expect(org).toBe("acme");
    expect(meta).toEqual({ segmentId: "seg-1", added: 3, removed: 2 });
    // No repo list, ever: the trail must stay bounded however big the segment grows.
    expect(JSON.stringify(meta)).not.toMatch(/fullName|repos/);
  });

  it("404s and audits NOTHING when there is no rule to apply (persistence off / unknown segment)", async () => {
    mockApply.mockResolvedValue(null);
    const res = await post("seg-1", {});
    expect(res.status).toBe(404);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe("PUT /api/org/segments/:id/rule — declare only", () => {
  it("stores the rule and does NOT converge (a declaration is not a write to the fleet)", async () => {
    const res = await put("seg-1", { kind: "team", values: ["@acme/platform"] });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("seg-1", { rule: { kind: "team", values: ["@acme/platform"] } });
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("clears the rule with { kind: null }, so a segment can go back to a hand-kept list", async () => {
    const res = await put("seg-1", { kind: null });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("seg-1", { rule: null });
  });

  it("404s another org's segment", async () => {
    mockOrgSlug.mockResolvedValue(null);
    expect((await put("ghost", { kind: "language", values: ["Go"] })).status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
