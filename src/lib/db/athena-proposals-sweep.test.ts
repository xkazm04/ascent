// THE REAPER. Every hold a proposal can be in names what ends it: a claim whose request died is
// stamped `interrupted` (never reopened - the executor's outcome is unknown and record_memory is not
// idempotent), and an ask nobody answered inside the TTL is WRITTEN `expired`, with a reason.
//
// The store is faked in memory (a matcher over the where-shapes the module uses) so the assertion is
// about the rows that result, not about which Prisma call was made.

import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = {
  id: string;
  orgId: string;
  threadId: string;
  turnId: string;
  kind: string;
  payloadJson: string;
  status: string;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  claimedAt: Date | null;
  createdAt: Date;
};

const h = vi.hoisted(() => ({ rows: [] as unknown[] }));

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
    const v = row[k];
    if (cond === null) return v === null;
    if (cond && typeof cond === "object" && !(cond instanceof Date) && "lt" in cond) {
      return v instanceof Date && v.getTime() < (cond as { lt: Date }).lt.getTime();
    }
    return v === cond;
  });
}

const fake = {
  athenaProposal: {
    findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
      (h.rows as Row[]).filter((r) => matches(r, where)).slice(0, take ?? 1000),
    ),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      const hit = (h.rows as Row[]).filter((r) => matches(r, where));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    }),
  },
};

vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true, getPrisma: () => fake }));

import { sweepAthenaProposals } from "@/lib/db/athena-proposals-sweep";
import { listOpenAthenaProposals } from "@/lib/db/athena-proposals";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;

const row = (over: Partial<Row>): Row => ({
  id: "p1",
  orgId: "org-1",
  threadId: "th1",
  turnId: "t1",
  kind: "record_memory",
  payloadJson: JSON.stringify({ params: { text: "x" } }),
  status: "open",
  resolvedAt: null,
  resolvedBy: null,
  claimedAt: null,
  createdAt: new Date(NOW - DAY),
  ...over,
});

const payloadOf = (r: Row) => JSON.parse(r.payloadJson) as { params?: unknown; outcome?: Record<string, unknown> };

beforeEach(() => {
  h.rows = [];
  vi.clearAllMocks();
});

describe("sweepAthenaProposals", () => {
  it("stamps a stale claim 'interrupted' and NEVER releases it back to open", async () => {
    h.rows = [row({ id: "c1", status: "accepted", resolvedBy: "dev", claimedAt: new Date(NOW - 20 * MIN) })];
    const res = await sweepAthenaProposals("org-1", NOW);
    const r = (h.rows as Row[])[0]!;
    expect(r.status).toBe("accepted");
    expect(r.resolvedAt).toBeInstanceOf(Date);
    expect(payloadOf(r).outcome).toMatchObject({ kind: "interrupted", ok: false });
    expect(payloadOf(r).params).toEqual({ text: "x" }); // the ask survives beside its outcome
    expect(res.interrupted.map((p) => p.id)).toEqual(["c1"]);
    // Every write the sweep made kept the row closed: no updateMany ever set status 'open'.
    for (const call of fake.athenaProposal.updateMany.mock.calls) {
      expect((call[0] as { data: { status?: string } }).data.status).not.toBe("open");
    }
  });

  it("leaves a FRESH claim alone - its request may still be running", async () => {
    h.rows = [row({ id: "c2", status: "accepted", claimedAt: new Date(NOW - 1 * MIN) })];
    const res = await sweepAthenaProposals("org-1", NOW);
    expect((h.rows as Row[])[0]!.resolvedAt).toBeNull();
    expect(res.interrupted).toEqual([]);
  });

  it("writes an open ask past the TTL as 'expired', so the open list stops returning it", async () => {
    h.rows = [
      row({ id: "old", createdAt: new Date(NOW - 15 * DAY) }),
      row({ id: "young", createdAt: new Date(NOW - 2 * DAY) }),
    ];
    const res = await sweepAthenaProposals("org-1", NOW);
    const old = (h.rows as Row[]).find((r) => r.id === "old")!;
    expect(old.status).toBe("expired");
    expect(old.resolvedAt).toBeInstanceOf(Date);
    expect(payloadOf(old).outcome).toMatchObject({ kind: "expired", ok: false });
    expect(res.expired.map((p) => p.id)).toEqual(["old"]);

    const open = await listOpenAthenaProposals("org-1");
    expect(open.map((p) => p.id)).toEqual(["young"]);
  });

  it("never reaches another tenant's rows", async () => {
    h.rows = [row({ id: "x", orgId: "org-2", createdAt: new Date(NOW - 30 * DAY) })];
    const res = await sweepAthenaProposals("org-1", NOW);
    expect((h.rows as Row[])[0]!.status).toBe("open");
    expect(res.expired).toEqual([]);
  });

  it("does not touch a resolved row, however old", async () => {
    const resolvedAt = new Date(NOW - 40 * DAY);
    h.rows = [row({ id: "r", status: "declined", resolvedAt, createdAt: new Date(NOW - 41 * DAY) })];
    await sweepAthenaProposals("org-1", NOW);
    expect((h.rows as Row[])[0]!).toMatchObject({ status: "declined", resolvedAt });
  });
});
