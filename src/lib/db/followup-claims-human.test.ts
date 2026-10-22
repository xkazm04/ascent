// The human claim verbs on the db side (followups-1): take over, send back, release. Each is an
// org-scoped compare-and-set on the claim generation it read, with one event per row and one audit row
// per batch. The fake Prisma's `updateMany` really is a compare-and-set, as in followup-claims.fence.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  status: string;
  claimActor: string | null;
  claimExecutor: string | null;
  leaseUntil: Date | null;
  needsHuman: boolean;
  orgId: string;
}

let rows: Row[] = [];
let events: { recommendationId: string; actor: string | null; kind: string; fromValue: string | null; toValue: string | null; note: string }[] = [];
let audits: { action: string; meta: Record<string, unknown>; opts: Record<string, unknown> }[] = [];
let updateWheres: Record<string, unknown>[] = [];

const row = (over: Partial<Row> = {}): Row => ({
  id: "rec-1",
  status: "in_progress",
  claimActor: "agent:tok_A",
  claimExecutor: "remote-agent",
  leaseUntil: null,
  needsHuman: true,
  orgId: "org-acme",
  ...over,
});

function matches(r: Row, where: Record<string, unknown>): boolean {
  if (typeof where.id === "string" && r.id !== where.id) return false;
  const idIn = (where.id as { in?: string[] } | undefined)?.in;
  if (Array.isArray(idIn) && !idIn.includes(r.id)) return false;
  if (typeof where.status === "string" && r.status !== where.status) return false;
  if ("claimActor" in where && r.claimActor !== where.claimActor) return false;
  if ("claimExecutor" in where && r.claimExecutor !== where.claimExecutor) return false;
  if ("needsHuman" in where && r.needsHuman !== where.needsHuman) return false;
  if ("leaseUntil" in where) {
    const l = where.leaseUntil as Date | null;
    if (l === null ? r.leaseUntil !== null : r.leaseUntil?.getTime() !== l.getTime()) return false;
  }
  const scan = where.scan as { repo?: { orgId?: string } } | undefined;
  if (scan?.repo?.orgId && r.orgId !== scan.repo.orgId) return false;
  return true;
}

const recommendation = {
  findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where)).map((r) => ({ ...r })),
  updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    updateWheres.push(where);
    const hits = rows.filter((r) => matches(r, where));
    for (const r of hits) Object.assign(r, data);
    return { count: hits.length };
  },
};
const recommendationEvent = {
  create: async ({ data }: { data: (typeof events)[number] }) => {
    events.push(data);
    return data;
  },
};

vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: vi.fn(async (s: string) => (s === "acme" ? { id: "org-acme" } : null)) }));
vi.mock("@/lib/db/scans-audit", () => ({
  recordAudit: vi.fn(async (action: string, meta: Record<string, unknown>, opts: Record<string, unknown>) => {
    audits.push({ action, meta, opts });
    return true;
  }),
}));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true, getPrisma: () => ({ recommendation, recommendationEvent }) }));

const { takeOverEscalations, sendBack, releaseHumanClaims, readClaimStates } = await import("@/lib/db/followup-claims-human");

beforeEach(() => {
  rows = [row()];
  events = [];
  audits = [];
  updateWheres = [];
});

describe("takeOverEscalations", () => {
  it("one CAS moves a needs-human row to the viewer's unleased human claim, one event names the displaced holder, one audit row", async () => {
    const res = await takeOverEscalations("acme", ["rec-1"], "ana");
    expect(res).toEqual({ done: ["rec-1"], skipped: [] });
    expect(updateWheres).toHaveLength(1);
    expect(updateWheres[0]).toMatchObject({ id: "rec-1", needsHuman: true, status: "in_progress", scan: { repo: { orgId: "org-acme" } } });
    expect(rows[0]).toMatchObject({ status: "in_progress", claimActor: "ana", claimExecutor: "human", leaseUntil: null, needsHuman: false });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ recommendationId: "rec-1", actor: "ana", kind: "status" });
    expect(events[0]!.note).toContain("agent:tok_A");
    expect(audits).toEqual([{ action: "followup.takeover", meta: expect.objectContaining({ ids: ["rec-1"], actor: "ana" }), opts: { orgId: "org-acme" } }]);
  });

  it("a row that is not needs-human is skipped as not-held and nothing is written", async () => {
    rows = [row({ needsHuman: false, leaseUntil: new Date(Date.now() + 60_000) })];
    const res = await takeOverEscalations("acme", ["rec-1"], "ana");
    expect(res!.skipped).toEqual([{ id: "rec-1", reason: "not-held" }]);
    expect(rows[0]!.claimActor).toBe("agent:tok_A");
    expect(events).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("another org's row is never touched", async () => {
    rows = [row({ orgId: "org-other" })];
    const res = await takeOverEscalations("acme", ["rec-1"], "ana");
    expect(res!.done).toEqual([]);
    expect(rows[0]!.claimActor).toBe("agent:tok_A");
  });
});

describe("sendBack", () => {
  it("returns a needs-human row to open with every claim column cleared, one event, one followup.release audit row", async () => {
    const res = await sendBack("acme", ["rec-1"], { login: "ana", admin: false });
    expect(res).toEqual({ done: ["rec-1"], skipped: [] });
    expect(rows[0]).toMatchObject({ status: "open", claimActor: null, claimExecutor: null, leaseUntil: null, needsHuman: false });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromValue: "in_progress", toValue: "open", actor: "ana" });
    expect(audits.map((a) => a.action)).toEqual(["followup.release"]);
    expect(audits[0]!.opts).toEqual({ orgId: "org-acme" });
  });

  it("a row that is no longer in progress is skipped as not-held and nothing is written", async () => {
    rows = [row({ status: "open", claimActor: null, claimExecutor: null, needsHuman: false })];
    const res = await sendBack("acme", ["rec-1"], { login: "ana", admin: true });
    expect(res).toEqual({ done: [], skipped: [{ id: "rec-1", reason: "not-held" }] });
    expect(updateWheres).toEqual([]);
    expect(events).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("a member cannot send back a live agent claim; an admin can, guarded on the lease it read", async () => {
    const lease = new Date(Date.now() + 30 * 60_000);
    rows = [row({ needsHuman: false, leaseUntil: lease })];
    expect((await sendBack("acme", ["rec-1"], { login: "ana", admin: false }))!.done).toEqual([]);
    expect(rows[0]!.status).toBe("in_progress");
    expect((await sendBack("acme", ["rec-1"], { login: "bo", admin: true }))!.done).toEqual(["rec-1"]);
    expect(updateWheres.at(-1)).toMatchObject({ leaseUntil: lease, claimActor: "agent:tok_A" });
  });
});

describe("releaseHumanClaims", () => {
  it("the holder releases their own hand-off; another member's release is skipped", async () => {
    rows = [row({ claimActor: "ana", claimExecutor: "human", needsHuman: false })];
    expect((await releaseHumanClaims("acme", ["rec-1"], { login: "bo", admin: false }))!.done).toEqual([]);
    expect(rows[0]!.status).toBe("in_progress");
    expect(await releaseHumanClaims("acme", ["rec-1"], { login: "ana", admin: false })).toEqual({ done: ["rec-1"], skipped: [] });
    expect(rows[0]).toMatchObject({ status: "open", claimActor: null, claimExecutor: null });
    expect(audits.map((a) => a.action)).toEqual(["followup.release"]);
  });

  it("never releases a leased machine claim, even for an admin", async () => {
    rows = [row({ needsHuman: false, leaseUntil: new Date(Date.now() + 60_000) })];
    expect((await releaseHumanClaims("acme", ["rec-1"], { login: "bo", admin: true }))!.skipped).toEqual([{ id: "rec-1", reason: "not-held" }]);
  });
});

describe("readClaimStates", () => {
  it("reads only this org's rows, with the lease as an ISO string", async () => {
    const lease = new Date("2026-10-22T13:00:00.000Z");
    rows = [row({ leaseUntil: lease }), row({ id: "rec-2", orgId: "org-other" })];
    const states = await readClaimStates("acme", ["rec-1", "rec-2"]);
    expect(states!.map((s) => s.id)).toEqual(["rec-1"]);
    expect(states![0]!.leaseUntil).toBe(lease.toISOString());
    expect(await readClaimStates("nope", ["rec-1"])).toBeNull();
  });
});
