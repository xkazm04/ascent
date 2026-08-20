// GET /api/org/briefing/share — the owner's inventory of issued briefing links.
//
// What must hold: the read is OWNER-gated like mint and revoke (its rows carry the `jti` that IS the
// revoke handle, so a softer gate would make the revoke route's gate decorative), it needs an `org`, it
// degrades to a 503 rather than an empty-looking "you've shared nothing" when there is no database, and
// the `limit` query is bounded by the lister rather than trusted from the URL.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class NextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new NextResponse(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
    }
  },
}));

const requireOrgRole = vi.fn<(org: string, role: string) => Promise<unknown>>(async () => null);
vi.mock("@/lib/authz", () => ({ requireOrgRole: (o: string, r: string) => requireOrgRole(o, r) }));
vi.mock("@/lib/api/orgPost", () => ({ requireOrgOwnerPost: vi.fn() }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => true, getViewer: vi.fn(async () => ({ login: "owner-a" })) }));
vi.mock("@/lib/briefing-share", () => ({
  briefingShareEnabled: () => true,
  briefingFigureDigest: vi.fn(() => "fig"),
  freezeShareWindow: vi.fn(() => ({ winStart: null, winEnd: "2026-08-01T00:00:00.000Z" })),
  signBriefingShareToken: vi.fn(() => null),
}));
vi.mock("@/lib/org/briefing", () => ({ buildExecBriefing: vi.fn(async () => null) }));

const listBriefingShareGrants = vi.fn<(org: string, o: { limit?: number }) => Promise<unknown[]>>(async () => []);
vi.mock("@/lib/db/org-share", () => ({ listBriefingShareGrants: (o: string, x: never) => listBriefingShareGrants(o, x) }));

let dbConfigured = true;
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => dbConfigured,
  getOrgId: vi.fn(async () => "org1"),
  getTechGroupIdByKey: vi.fn(async () => null),
  recordAudit: vi.fn(async () => true),
}));

import { GET } from "./route";
import { NextResponse } from "next/server";

const call = (qs: string) => GET(new Request(`http://localhost/api/org/briefing/share${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  dbConfigured = true;
  requireOrgRole.mockImplementation(async () => null);
  listBriefingShareGrants.mockImplementation(async () => []);
});

describe("listing the briefing share grants an org has issued", () => {
  it("returns the grants for the org, owner-gated", async () => {
    const grant = { jti: "g1", mintedAt: "2026-08-01T00:00:00.000Z", mintedBy: "owner-a", revoked: false, expired: false };
    listBriefingShareGrants.mockImplementation(async () => [grant]);
    const res = await call("?org=acme");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ grants: [grant] });
    expect(requireOrgRole).toHaveBeenCalledWith("acme", "owner");
  });

  it("returns the gate's own response for a non-owner, and lists nothing", async () => {
    requireOrgRole.mockImplementation(async () => NextResponse.json({ error: "Forbidden" }, { status: 403 }) as unknown);
    expect((await call("?org=acme")).status).toBe(403);
    expect(listBriefingShareGrants).not.toHaveBeenCalled();
  });

  it("400s without ?org, and 503s with no database", async () => {
    expect((await call("")).status).toBe(400);
    dbConfigured = false;
    expect((await call("?org=acme")).status).toBe(503);
    expect(listBriefingShareGrants).not.toHaveBeenCalled();
  });

  it("passes a positive limit through and drops a junk one, leaving the default to the lister", async () => {
    await call("?org=acme&limit=5");
    expect(listBriefingShareGrants).toHaveBeenCalledWith("acme", { limit: 5 });
    await call("?org=acme&limit=-3");
    expect(listBriefingShareGrants).toHaveBeenLastCalledWith("acme", { limit: undefined });
    await call("?org=acme&limit=abc");
    expect(listBriefingShareGrants).toHaveBeenLastCalledWith("acme", { limit: undefined });
  });
});
