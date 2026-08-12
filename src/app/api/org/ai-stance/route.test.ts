// Auth + write contracts of /api/org/ai-stance (W3), the clone of the gate-policy route's shape:
// member read, owner-gated same-origin write, an empty-after-sanitize stance REFUSED (an absent
// stance is the absence of rows, never a published empty document), and every write audit-logged
// with WHAT the stance became (action + version + terse summary), not just that it moved.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  // instanceof-compatible: requireOrgOwnerPost's caller branches on `gate instanceof NextResponse`,
  // so the mock's json() must return an instance of the mocked class, not a bare Response.
  NextResponse: class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(JSON.stringify(body), { status: (init as { status?: number })?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  },
}));

const h = vi.hoisted(() => ({
  requireOrgRead: vi.fn(),
  requireOrgRole: vi.fn(),
  requireSameOrigin: vi.fn(),
  recordOrgAudit: vi.fn(),
  getActiveOrgStance: vi.fn(),
  getDraftOrgStance: vi.fn(),
  listOrgStanceVersions: vi.fn(),
  saveOrgStanceDraft: vi.fn(),
  publishOrgStance: vi.fn(),
  resolveViewerLogin: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getActiveOrgStance: h.getActiveOrgStance,
  getDraftOrgStance: h.getDraftOrgStance,
  listOrgStanceVersions: h.listOrgStanceVersions,
  saveOrgStanceDraft: h.saveOrgStanceDraft,
  publishOrgStance: h.publishOrgStance,
  recordOrgAudit: h.recordOrgAudit,
}));
vi.mock("@/lib/authz", () => ({ requireOrgRead: h.requireOrgRead, requireOrgRole: h.requireOrgRole }));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: h.requireSameOrigin }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: h.resolveViewerLogin }));

import { GET, POST } from "./route";
import { NextResponse } from "next/server";

/** A denial the route's `instanceof NextResponse` checks recognize. */
const deny = (status: number) => NextResponse.json({ error: "denied" }, { status });

const stance = {
  permittedTools: ["Claude Code"],
  permittedModels: [],
  noAiZones: [],
  reviewTiers: [],
  provenance: { requireTrailer: true, requireHumanApproval: false },
};
const storedRow = { id: "row", version: 2, status: "published", stance, publishedBy: "alice", publishedAt: new Date(), createdAt: new Date() };

const post = (body: unknown) =>
  POST(new Request("http://t/api/org/ai-stance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.requireOrgRead.mockResolvedValue(null);
  h.requireOrgRole.mockResolvedValue(null);
  h.requireSameOrigin.mockReturnValue(null);
  h.recordOrgAudit.mockResolvedValue(true);
  h.getActiveOrgStance.mockResolvedValue(storedRow);
  h.getDraftOrgStance.mockResolvedValue(null);
  h.listOrgStanceVersions.mockResolvedValue([storedRow]);
  h.saveOrgStanceDraft.mockResolvedValue({ ...storedRow, status: "draft", version: 3 });
  h.publishOrgStance.mockResolvedValue({ ...storedRow, version: 3 });
  h.resolveViewerLogin.mockResolvedValue("alice");
});

describe("GET /api/org/ai-stance", () => {
  it("requires ?org and the member-read gate", async () => {
    expect((await GET(new Request("http://t/api/org/ai-stance"))).status).toBe(400);
    h.requireOrgRead.mockResolvedValue(Response.json({ error: "no" }, { status: 403 }));
    expect((await GET(new Request("http://t/api/org/ai-stance?org=acme"))).status).toBe(403);
  });

  it("returns active + draft + versions", async () => {
    const res = await GET(new Request("http://t/api/org/ai-stance?org=acme"));
    const body = await res.json();
    expect(body.active.version).toBe(2);
    expect(body.versions).toHaveLength(1);
  });
});

describe("POST /api/org/ai-stance", () => {
  it("is owner-gated and same-origin (via requireOrgOwnerPost)", async () => {
    h.requireOrgRole.mockResolvedValue(deny(403));
    expect((await post({ org: "acme", action: "publish", stance })).status).toBe(403);
    expect(h.requireOrgRole).toHaveBeenCalledWith("acme", "owner");

    h.requireOrgRole.mockResolvedValue(null);
    h.requireSameOrigin.mockReturnValue(deny(403));
    expect((await post({ org: "acme", action: "publish", stance })).status).toBe(403);
  });

  it("rejects a missing/unknown action with 400", async () => {
    expect((await post({ org: "acme", stance })).status).toBe(400);
    expect((await post({ org: "acme", action: "delete", stance })).status).toBe(400);
  });

  it("publish → publishOrgStance with the resolved actor, and audits action + version", async () => {
    const res = await post({ org: "acme", action: "publish", stance });
    expect(res.status).toBe(200);
    expect(h.publishOrgStance).toHaveBeenCalledWith("acme", stance, "alice");
    const [action, org, meta, actor] = h.recordOrgAudit.mock.calls[0]!;
    expect(action).toBe("org.ai_stance");
    expect(org).toBe("acme");
    expect(meta).toMatchObject({ action: "publish", version: 3 });
    expect(String(meta.status)).toContain("published v3");
    expect(String(meta.status)).toContain("1 tools");
    expect(actor).toBe("alice");
  });

  it("draft → saveOrgStanceDraft (no publish stamp)", async () => {
    const res = await post({ org: "acme", action: "draft", stance });
    expect(res.status).toBe(200);
    expect(h.saveOrgStanceDraft).toHaveBeenCalledWith("acme", stance);
    expect(h.publishOrgStance).not.toHaveBeenCalled();
  });

  it("refuses an empty-after-sanitize stance with 400 (never a published empty document)", async () => {
    h.publishOrgStance.mockResolvedValue(null);
    const res = await post({ org: "acme", action: "publish", stance: { permittedTools: [] } });
    expect(res.status).toBe(400);
    expect(h.recordOrgAudit).not.toHaveBeenCalled();
  });

  it("404s an unknown organization", async () => {
    h.publishOrgStance.mockResolvedValue(undefined);
    expect((await post({ org: "ghost", action: "publish", stance })).status).toBe(404);
  });
});
