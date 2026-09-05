// POST /api/org/briefing/share/revoke — the owner's kill switch for ONE issued briefing link.
//
// What must hold: the gate is the mint route's gate (any owner, same-origin — not "only the minter",
// which strands the org when they leave, and not "any member", which is a DoS on a colleague's shared
// document); a revoke that cannot be persisted must NOT be reported as done (no DB → 503, write failure
// → 500); the write is not blocked by the grant being missing from the retention-bounded audit list; and
// the action is recorded with the actor who ended it.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  // A Response SUBCLASS, not a bare object: the handler branches on `gate instanceof NextResponse`,
  // so the gate's rejection must be both a real Response and an instance of this class.
  NextResponse: class NextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new NextResponse(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
    }
  },
}));

const requireOrgOwnerPost = vi.fn(async (req: Request) => ({ org: "acme", body: await req.json() }) as unknown);
vi.mock("@/lib/api/orgPost", () => ({ requireOrgOwnerPost: (r: Request) => requireOrgOwnerPost(r) }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => true, getViewer: vi.fn(async () => ({ login: "owner-b" })) }));

let enabled = true;
vi.mock("@/lib/briefing-share", () => ({ briefingShareEnabled: () => enabled }));

const revokeBriefingShareLink = vi.fn<(jti: string) => Promise<void>>(async () => {});
const listBriefingShareGrants = vi.fn<(org: string) => Promise<unknown[]>>(async () => []);
vi.mock("@/lib/db/org-share", () => ({
  revokeBriefingShareLink: (j: string) => revokeBriefingShareLink(j),
  listBriefingShareGrants: (o: string) => listBriefingShareGrants(o),
}));

let dbConfigured = true;
const recordAudit = vi.fn(async () => true);
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => dbConfigured,
  getOrgId: vi.fn(async () => "org1"),
  recordAudit: (a: string, m: unknown, o: unknown) => recordAudit(a as never, m as never, o as never),
}));

import { POST } from "./route";
import { NextResponse } from "next/server";

const call = (body: unknown) =>
  POST(new Request("http://localhost/api/org/briefing/share/revoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  enabled = true;
  dbConfigured = true;
  revokeBriefingShareLink.mockImplementation(async () => {});
  listBriefingShareGrants.mockImplementation(async () => []);
  requireOrgOwnerPost.mockImplementation(async (req: Request) => ({ org: "acme", body: await req.json() }) as unknown);
});

describe("revoking one briefing share link", () => {
  it("bumps the ledger for that jti and records who did it", async () => {
    listBriefingShareGrants.mockImplementation(async () => [{ jti: "g1", mintedBy: "owner-a", mintedAt: "2026-08-01T00:00:00.000Z" }]);
    const res = await call({ org: "acme", jti: "g1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, jti: "g1" });
    expect(revokeBriefingShareLink).toHaveBeenCalledWith("g1");
    expect(recordAudit).toHaveBeenCalledWith(
      "briefing.share.revoked",
      expect.objectContaining({ jti: "g1", mintedBy: "owner-a", grantFound: true }),
      expect.objectContaining({ actorId: "owner-b" }),
    );
  });

  it("revokes a grant that is NOT in the audit-bounded list — the case that matters most", async () => {
    // A mint row aged out of retention while the token's TTL is still running. Refusing here would leave
    // the owner with no way to kill a link they can prove is leaked.
    const res = await call({ org: "acme", jti: "ancient" });
    expect(res.status).toBe(200);
    expect(revokeBriefingShareLink).toHaveBeenCalledWith("ancient");
    expect(recordAudit).toHaveBeenCalledWith("briefing.share.revoked", expect.objectContaining({ grantFound: false }), expect.anything());
  });

  it("survives a failing grant lookup — it is a record, not a gate", async () => {
    listBriefingShareGrants.mockImplementation(async () => {
      throw new Error("audit read down");
    });
    expect((await call({ org: "acme", jti: "g1" })).status).toBe(200);
    expect(revokeBriefingShareLink).toHaveBeenCalledWith("g1");
  });

  it("is idempotent: revoking twice is still a success", async () => {
    expect((await call({ org: "acme", jti: "g1" })).status).toBe(200);
    expect((await call({ org: "acme", jti: "g1" })).status).toBe(200);
  });

  it("returns the owner gate's own response when the caller isn't an owner", async () => {
    requireOrgOwnerPost.mockImplementation(async () => NextResponse.json({ error: "Forbidden" }, { status: 403 }) as unknown);
    const res = await call({ org: "acme", jti: "g1" });
    expect(res.status).toBe(403);
    expect(revokeBriefingShareLink).not.toHaveBeenCalled();
  });

  it("400s without a jti — there is no 'revoke everything' shape", async () => {
    const res = await call({ org: "acme", jti: "   " });
    expect(res.status).toBe(400);
    expect(revokeBriefingShareLink).not.toHaveBeenCalled();
  });

  it("503s rather than no-oping when there is no ledger to write to", async () => {
    dbConfigured = false;
    expect((await call({ org: "acme", jti: "g1" })).status).toBe(503);
    enabled = false;
    dbConfigured = true;
    expect((await call({ org: "acme", jti: "g1" })).status).toBe(503);
    expect(revokeBriefingShareLink).not.toHaveBeenCalled();
  });

  it("500s when the ledger write fails, instead of claiming the link is dead", async () => {
    revokeBriefingShareLink.mockImplementation(async () => {
      throw new Error("write failed");
    });
    const res = await call({ org: "acme", jti: "g1" });
    expect(res.status).toBe(500);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
