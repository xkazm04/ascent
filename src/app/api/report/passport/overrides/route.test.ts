// Route test for /api/report/passport/overrides (P4a). Pins the owner-gated, public-rejected write path:
// the org is resolved from the repo owner; the public funnel is refused; a non-owner is denied verbatim;
// an unknown repo is 404; the happy path persists + audits. next/server faked; db/auth/authz mocked.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  },
}));

const h = vi.hoisted(() => ({
  isDbConfigured: vi.fn(),
  setPassportOverrides: vi.fn(),
  mergePassportDeclines: vi.fn(),
  recordOrgAudit: vi.fn(),
  readableOrgForOwner: vi.fn(),
  isSameOrigin: vi.fn(),
  getSession: vi.fn(),
  requireOrgRole: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: h.isDbConfigured,
  setPassportOverrides: h.setPassportOverrides,
  mergePassportDeclines: h.mergePassportDeclines,
  recordOrgAudit: h.recordOrgAudit,
}));
vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public", readableOrgForOwner: h.readableOrgForOwner, isSameOrigin: h.isSameOrigin, getSession: h.getSession }));
vi.mock("@/lib/authz", () => ({ requireOrgRole: h.requireOrgRole }));

import { PATCH, POST } from "./route";

const post = (body: unknown) => new Request("http://t/api/report/passport/overrides", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const patch = (body: unknown) => new Request("http://t/api/report/passport/overrides", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  h.isDbConfigured.mockReturnValue(true);
  h.isSameOrigin.mockReturnValue(true);
  h.readableOrgForOwner.mockResolvedValue("acme");
  h.requireOrgRole.mockResolvedValue(null); // owner
  h.setPassportOverrides.mockResolvedValue(true);
  h.mergePassportDeclines.mockResolvedValue(true);
  h.recordOrgAudit.mockResolvedValue(undefined);
  h.getSession.mockResolvedValue({ login: "alice" });
});

describe("POST /api/report/passport/overrides", () => {
  it("503 db off · 403 cross-origin · 400 bad repo", async () => {
    h.isDbConfigured.mockReturnValue(false);
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(503);
    h.isDbConfigured.mockReturnValue(true);
    h.isSameOrigin.mockReturnValue(false);
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(403);
    h.isSameOrigin.mockReturnValue(true);
    expect((await POST(post({ repo: "notarepo" }))).status).toBe(400);
  });

  it("refuses the public funnel (no owner concept there), no write", async () => {
    h.readableOrgForOwner.mockResolvedValue("public");
    const res = await POST(post({ repo: "someone/web", criticality: "business" }));
    expect(res.status).toBe(403);
    expect(h.requireOrgRole).not.toHaveBeenCalled();
    expect(h.setPassportOverrides).not.toHaveBeenCalled();
  });

  it("denies a non-owner verbatim, no write", async () => {
    h.requireOrgRole.mockResolvedValue(Response.json({ error: "owner only" }, { status: 403 }));
    const res = await POST(post({ repo: "acme/web", rollback: true }));
    expect(res.status).toBe(403);
    expect(h.requireOrgRole).toHaveBeenCalledWith("acme", "owner");
    expect(h.setPassportOverrides).not.toHaveBeenCalled();
  });

  it("404 for an unknown repo", async () => {
    h.setPassportOverrides.mockResolvedValue(false);
    expect((await POST(post({ repo: "acme/web", rollback: true }))).status).toBe(404);
  });

  it("persists + audits on the happy path", async () => {
    const res = await POST(post({ repo: "acme/web", criticality: "mission-critical", lifecycle: "ga", rollback: true }));
    expect(res.status).toBe(200);
    expect(h.setPassportOverrides).toHaveBeenCalledWith("acme", "acme/web", { criticality: "mission-critical", lifecycle: "ga", rollback: true });
    expect(h.recordOrgAudit.mock.calls[0][0]).toBe("passport.overrides_set");
  });

  it("accepts declined-by-choice entries and validates the field path against the allow-list", async () => {
    const ok = await POST(post({ repo: "acme/web", declined: { "stack.monitoring.errorTracking": { reason: " by choice " } } }));
    expect(ok.status).toBe(200);
    expect(h.setPassportOverrides.mock.calls[0][2]).toMatchObject({ declined: { "stack.monitoring.errorTracking": { reason: "by choice" } } });

    const bad = await POST(post({ repo: "acme/web", declined: { "productionReadiness.score": {} } }));
    expect(bad.status).toBe(400);
    expect(h.setPassportOverrides).toHaveBeenCalledTimes(1); // no partial write
  });
});

describe("PATCH /api/report/passport/overrides (declines)", () => {
  it("merges a decline keyed by field path, and audits it", async () => {
    const res = await PATCH(patch({ repo: "acme/web", declined: { "productionReadiness.delivery.iac": { reason: "serverless" } } }));
    expect(res.status).toBe(200);
    expect(h.mergePassportDeclines).toHaveBeenCalledWith("acme", "acme/web", { "productionReadiness.delivery.iac": { reason: "serverless" } });
    expect(h.recordOrgAudit.mock.calls[0][0]).toBe("passport.declines_set");
  });

  it("a null value RETRACTS a decline", async () => {
    await PATCH(patch({ repo: "acme/web", declined: { "productionReadiness.delivery.iac": null } }));
    expect(h.mergePassportDeclines).toHaveBeenCalledWith("acme", "acme/web", { "productionReadiness.delivery.iac": null });
  });

  it("400s an unknown field path and an empty body; 403 for the public funnel; 404 for an unknown repo", async () => {
    expect((await PATCH(patch({ repo: "acme/web", declined: { "evidence.source": {} } }))).status).toBe(400);
    expect((await PATCH(patch({ repo: "acme/web" }))).status).toBe(400);
    expect(h.mergePassportDeclines).not.toHaveBeenCalled();
    h.readableOrgForOwner.mockResolvedValue("public");
    expect((await PATCH(patch({ repo: "x/y", declined: { "productionReadiness.ci": {} } }))).status).toBe(403);
    h.readableOrgForOwner.mockResolvedValue("acme");
    h.mergePassportDeclines.mockResolvedValue(false);
    expect((await PATCH(patch({ repo: "acme/web", declined: { "productionReadiness.ci": {} } }))).status).toBe(404);
  });
});
