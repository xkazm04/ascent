// The weekly digest's follow-up reads, against a fake Prisma that evaluates the parts of a `where`
// this module actually writes. Two properties are pinned here that nothing else in the suite can:
//
//   1. CLOSED is an event count with a HALF-OPEN upper bound. The bound arrives through the shared
//      `dateRange` helper, so if that ever regressed to `lte` a boundary event would be counted by
//      two adjacent weeks — the assertion is on the emitted `where`, because that is where the bug
//      would live.
//   2. OPENED is an identity diff, and its whole correctness is "a gap carried forward across a
//      rescan is NOT new". Recommendation rows are recreated on every scan (scans-persist.ts), so the
//      naive `createdAt in window` read would report a rescanned repository's entire backlog as
//      opened this week. The carried-forward test is the one that fails if anyone reaches for
//      `createdAt`.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPrisma, mockIsDbConfigured } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  mockIsDbConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: mockIsDbConfigured }));

import {
  countScansInWindow,
  getFollowupsClosedInWindow,
  getFollowupsOpenedInWindow,
} from "@/lib/db/org-followups-week";

const ORG = "org-1";
const start = new Date("2026-08-26T00:00:00.000Z");
const endExclusive = new Date("2026-09-02T00:00:00.000Z");
const WEEK = { start, endExclusive };

interface ScanRow {
  id: string;
  repoId: string;
  scannedAt: Date;
  fullName: string;
}
interface RecRow {
  scanId: string;
  title: string;
  dimId: string;
  kind: string;
  status: string;
}
interface EventRow {
  actor: string | null;
  createdAt: Date;
  kind: string;
  toValue: string | null;
  recKind: string;
  title: string;
  dimId: string;
  repoFullName: string;
}

let scans: ScanRow[] = [];
let recs: RecRow[] = [];
let events: EventRow[] = [];
let orgRow: { id: string } | null = { id: ORG };
/** Every `where` this module emitted, in call order — the assertions on query SHAPE read these. */
let seen: { model: string; op: string; where: Record<string, unknown> }[] = [];

const record = (model: string, op: string, where: Record<string, unknown>) => {
  seen.push({ model, op, where });
};
const whereFor = (model: string, op: string) => seen.filter((s) => s.model === model && s.op === op);

/** Honest evaluation of the date fragment this module writes: `{ gte, lt }`, never `lte`. */
function inRange(d: Date, f: { gte?: Date; lt?: Date; lte?: Date } | undefined): boolean {
  if (!f) return true;
  if (f.gte && d < f.gte) return false;
  if (f.lt && !(d < f.lt)) return false;
  if (f.lte && !(d <= f.lte)) return false;
  return true;
}

function fakePrisma() {
  return {
    organization: { findUnique: async () => orgRow },
    recommendationEvent: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        record("recommendationEvent", "count", where);
        return events.filter((e) => matchEvent(e, where)).length;
      },
      findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
        record("recommendationEvent", "findMany", where);
        return events
          .filter((e) => matchEvent(e, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, take ?? undefined)
          .map((e) => ({
            actor: e.actor,
            createdAt: e.createdAt,
            recommendation: { title: e.title, dimId: e.dimId, scan: { repo: { fullName: e.repoFullName } } },
          }));
      },
    },
    scan: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        record("scan", "count", where);
        const f = where.scannedAt as { gte?: Date; lt?: Date } | undefined;
        return scans.filter((s) => inRange(s.scannedAt, f)).length;
      },
      groupBy: async ({ where }: { where: Record<string, unknown> }) => {
        record("scan", "groupBy", where);
        const f = where.scannedAt as { gte?: Date; lt?: Date } | undefined;
        const max = new Map<string, Date>();
        for (const s of scans.filter((x) => inRange(x.scannedAt, f))) {
          const cur = max.get(s.repoId);
          if (!cur || s.scannedAt > cur) max.set(s.repoId, s.scannedAt);
        }
        return [...max.entries()].map(([repoId, scannedAt]) => ({ repoId, _max: { scannedAt } }));
      },
      findMany: async ({ where }: { where: { OR?: { repoId: string; scannedAt: Date }[] } }) => {
        record("scan", "findMany", where as Record<string, unknown>);
        const pairs = where.OR ?? [];
        return scans
          .filter((s) => pairs.some((p) => p.repoId === s.repoId && p.scannedAt.getTime() === s.scannedAt.getTime()))
          .map((s) => ({ id: s.id, repoId: s.repoId, repo: { fullName: s.fullName } }));
      },
    },
    recommendation: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        record("recommendation", "findMany", where);
        const ids = (where.scanId as { in: string[] }).in;
        const status = where.status as { in: string[] } | undefined;
        return recs
          .filter((r) => ids.includes(r.scanId))
          .filter((r) => r.kind === where.kind)
          .filter((r) => !status || status.in.includes(r.status))
          .map((r) => ({ scanId: r.scanId, title: r.title, dimId: r.dimId }));
      },
    },
  };
}

function matchEvent(e: EventRow, where: Record<string, unknown>): boolean {
  if (where.kind && e.kind !== where.kind) return false;
  if ("toValue" in where && e.toValue !== where.toValue) return false;
  if (!inRange(e.createdAt, where.createdAt as { gte?: Date; lt?: Date } | undefined)) return false;
  const rec = where.recommendation as { kind?: string } | undefined;
  if (rec?.kind && e.recKind !== rec.kind) return false;
  return true;
}

const scan = (id: string, repoId: string, iso: string, fullName = `acme/${repoId}`): ScanRow => ({
  id,
  repoId,
  scannedAt: new Date(iso),
  fullName,
});
const rec = (scanId: string, dimId: string, title: string, over: Partial<RecRow> = {}): RecRow => ({
  scanId,
  dimId,
  title,
  kind: "gap",
  status: "open",
  ...over,
});
const evt = (over: Partial<EventRow> = {}): EventRow => ({
  actor: null,
  createdAt: new Date("2026-08-28T10:00:00.000Z"),
  kind: "status",
  toValue: "done",
  recKind: "gap",
  title: "No dependency review on pull requests",
  dimId: "D9",
  repoFullName: "acme/api",
  ...over,
});

beforeEach(() => {
  scans = [];
  recs = [];
  events = [];
  orgRow = { id: ORG };
  seen = [];
  mockIsDbConfigured.mockReturnValue(true);
  mockGetPrisma.mockReturnValue(fakePrisma());
});

describe("getFollowupsClosedInWindow", () => {
  it("scopes to status events on GAP recommendations inside the org, with a HALF-OPEN upper bound", async () => {
    events = [evt()];
    await getFollowupsClosedInWindow("acme", WEEK);

    const w = whereFor("recommendationEvent", "count")[0]!.where;
    expect(w.kind).toBe("status");
    expect(w.toValue).toBe("done");
    // The bound must be `lt`, never `lte`: at microsecond storage resolution an `lte` upper bound and
    // the next window's `gte` lower bound both match the same event.
    expect(w.createdAt).toEqual({ gte: start, lt: endExclusive });
    expect(w).not.toHaveProperty("createdAt.lte");
    // Org scope travels through recommendation → scan → repo, and craft entries are excluded: a craft
    // row is never a follow-up the team owed, so closing one is not debt paid down.
    expect(w.recommendation).toEqual({ kind: "gap", scan: { repo: { orgId: ORG } } });
  });

  it("counts done and dismissed SEPARATELY — a dismissal is never folded into closures", async () => {
    events = [
      evt({ toValue: "done" }),
      evt({ toValue: "done" }),
      evt({ toValue: "dismissed", title: "Declined" }),
      evt({ toValue: "in_progress", title: "Started" }),
    ];
    const out = await getFollowupsClosedInWindow("acme", WEEK);
    expect(out.closed).toBe(2);
    expect(out.dismissed).toBe(1);
    // Only the `done` events become rows.
    expect(out.rows).toHaveLength(2);
  });

  it("excludes events outside the half-open window", async () => {
    events = [
      evt({ createdAt: new Date("2026-08-25T23:59:59.999Z") }), // before start
      evt({ createdAt: start }), // exactly at start — inside
      evt({ createdAt: endExclusive }), // exactly at endExclusive — OUTSIDE
    ];
    expect((await getFollowupsClosedInWindow("acme", WEEK)).closed).toBe(1);
  });

  it("derives `how` from the actor: a login is a person, null is the rescan resolver", async () => {
    events = [
      evt({ actor: "dana", createdAt: new Date("2026-08-29T10:00:00.000Z"), title: "By hand" }),
      evt({ actor: null, createdAt: new Date("2026-08-28T10:00:00.000Z"), title: "By rescan" }),
    ];
    const out = await getFollowupsClosedInWindow("acme", WEEK);
    expect(out.rows.map((r) => [r.title, r.how])).toEqual([
      ["By hand", "human"],
      ["By rescan", "scan"],
    ]);
    // The dimension label is resolved from the rubric, not carried on the row.
    expect(out.rows[0]!.dimLabel).not.toBe("D9");
    expect(out.rows[0]!.at).toBe("2026-08-29T10:00:00.000Z");
    expect(out.rows[0]!.repo).toBe("acme/api");
  });

  it("caps the rows at `limit` while the counts stay complete", async () => {
    events = Array.from({ length: 7 }, (_, i) =>
      evt({ createdAt: new Date(`2026-08-2${7 + (i % 3)}T0${i}:00:00.000Z`), title: `gap ${i}` }),
    );
    const out = await getFollowupsClosedInWindow("acme", WEEK, 2);
    expect(out.closed).toBe(7);
    expect(out.rows).toHaveLength(2);
  });

  it("returns zeros — not a throw — when the DB is unconfigured or the org is unknown", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await getFollowupsClosedInWindow("acme", WEEK)).toEqual({ closed: 0, dismissed: 0, rows: [] });
    mockIsDbConfigured.mockReturnValue(true);
    orgRow = null;
    expect(await getFollowupsClosedInWindow("nope", WEEK)).toEqual({ closed: 0, dismissed: 0, rows: [] });
  });
});

describe("getFollowupsOpenedInWindow — the identity diff", () => {
  it("does NOT count a gap carried forward across a rescan, and DOES count a new identity", async () => {
    // One repo, scanned before the window and again inside it. `carried` exists on both sides — the
    // rescan RECREATED the row, so its createdAt is this week's, but the gap is not new. `fresh` is
    // absent from the baseline scan and is therefore genuinely opened.
    scans = [scan("s-old", "r1", "2026-08-20T00:00:00.000Z"), scan("s-new", "r1", "2026-08-28T00:00:00.000Z")];
    recs = [
      rec("s-old", "D3", "carried"),
      rec("s-new", "D3", "carried"),
      rec("s-new", "D9", "fresh"),
    ];

    const out = await getFollowupsOpenedInWindow("acme", WEEK);
    expect(out).not.toBeNull();
    expect(out!.opened).toBe(1);
    expect(out!.rows.map((r) => r.title)).toEqual(["fresh"]);
    expect(out!.rows[0]).toMatchObject({ dimId: "D9", repo: "acme/r1", at: null, how: null });
    expect(out!.unmeasuredRepos).toBe(0);
  });

  it("treats an identity that existed in ANY state before the window as carried forward", async () => {
    // The baseline read must not filter on status: a gap that was `done` before the window and is
    // open again now is a REOPEN, not this week's new gap.
    scans = [scan("s-old", "r1", "2026-08-20T00:00:00.000Z"), scan("s-new", "r1", "2026-08-28T00:00:00.000Z")];
    recs = [rec("s-old", "D3", "carried", { status: "done" }), rec("s-new", "D3", "carried")];
    expect((await getFollowupsOpenedInWindow("acme", WEEK))!.opened).toBe(0);
  });

  it("ignores settled and craft rows on the present side", async () => {
    scans = [scan("s-old", "r1", "2026-08-20T00:00:00.000Z"), scan("s-new", "r1", "2026-08-28T00:00:00.000Z")];
    recs = [
      rec("s-new", "D1", "already done", { status: "done" }),
      rec("s-new", "D2", "craft polish", { kind: "craft" }),
      rec("s-new", "D4", "in flight", { status: "in_progress" }),
    ];
    const out = await getFollowupsOpenedInWindow("acme", WEEK);
    expect(out!.opened).toBe(1);
    expect(out!.rows[0]!.title).toBe("in flight");
  });

  it("EXCLUDES a repo with no pre-window scan and COUNTS it in unmeasuredRepos", async () => {
    // r1 is measurable. r2 was first scanned inside the window: its whole backlog would read as this
    // week's regression if "no baseline" were treated as "empty baseline".
    scans = [
      scan("s-old", "r1", "2026-08-20T00:00:00.000Z"),
      scan("s-new", "r1", "2026-08-28T00:00:00.000Z"),
      scan("s-r2", "r2", "2026-08-27T00:00:00.000Z"),
    ];
    recs = [rec("s-new", "D3", "fresh"), rec("s-r2", "D1", "onboarding backlog"), rec("s-r2", "D2", "more")];

    const out = await getFollowupsOpenedInWindow("acme", WEEK);
    expect(out!.opened).toBe(1);
    expect(out!.rows.map((r) => r.title)).toEqual(["fresh"]);
    expect(out!.unmeasuredRepos).toBe(1);
  });

  it("returns null when NO repo has a pre-window scan — unmeasurable is not zero", async () => {
    scans = [scan("s-r2", "r2", "2026-08-27T00:00:00.000Z")];
    recs = [rec("s-r2", "D1", "onboarding backlog")];
    expect(await getFollowupsOpenedInWindow("acme", WEEK)).toBeNull();
  });

  it("returns null for an open-ended window (no start = no 'before')", async () => {
    scans = [scan("s-old", "r1", "2026-08-20T00:00:00.000Z")];
    expect(await getFollowupsOpenedInWindow("acme", { start: null, endExclusive })).toBeNull();
  });

  it("returns null when the DB is unconfigured or the org is unknown", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await getFollowupsOpenedInWindow("acme", WEEK)).toBeNull();
    mockIsDbConfigured.mockReturnValue(true);
    orgRow = null;
    expect(await getFollowupsOpenedInWindow("nope", WEEK)).toBeNull();
  });

  it("picks the latest scan per repo with groupBy _max — never a nested take:1", async () => {
    scans = [scan("s-old", "r1", "2026-08-20T00:00:00.000Z"), scan("s-new", "r1", "2026-08-28T00:00:00.000Z")];
    recs = [rec("s-new", "D3", "fresh")];
    await getFollowupsOpenedInWindow("acme", WEEK);

    const groupBys = whereFor("scan", "groupBy");
    expect(groupBys).toHaveLength(2);
    // Unbounded for "as things stand"; strictly `lt: start` for the baseline, so a scan landing
    // exactly on the boundary belongs to the window and not to what it is compared against.
    expect(groupBys[0]!.where).toEqual({ repo: { orgId: ORG } });
    expect(groupBys[1]!.where).toEqual({ repo: { orgId: ORG }, scannedAt: { lt: start } });
    // The scan rows are then fetched by exact (repoId, scannedAt) pairs.
    expect(whereFor("scan", "findMany")[0]!.where).toHaveProperty("OR");
  });

  it("caps rows at `limit` while `opened` stays the full count", async () => {
    scans = [scan("s-old", "r1", "2026-08-20T00:00:00.000Z"), scan("s-new", "r1", "2026-08-28T00:00:00.000Z")];
    recs = [rec("s-old", "D1", "carried"), ...["a", "b", "c", "d"].map((t, i) => rec("s-new", `D${i + 2}`, t))];
    const out = await getFollowupsOpenedInWindow("acme", WEEK, 2);
    expect(out!.opened).toBe(4);
    expect(out!.rows).toHaveLength(2);
  });
});

describe("countScansInWindow", () => {
  it("counts scans in the half-open window, org-scoped", async () => {
    scans = [
      scan("s1", "r1", "2026-08-25T00:00:00.000Z"), // before
      scan("s2", "r1", "2026-08-26T00:00:00.000Z"), // at start — in
      scan("s3", "r1", "2026-09-01T23:00:00.000Z"), // in
      scan("s4", "r1", "2026-09-02T00:00:00.000Z"), // at endExclusive — out
    ];
    expect(await countScansInWindow("acme", WEEK)).toBe(2);
    const w = whereFor("scan", "count")[0]!.where;
    expect(w.repo).toEqual({ orgId: ORG });
    expect(w.scannedAt).toEqual({ gte: start, lt: endExclusive });
  });

  it("returns 0 when the DB is unconfigured or the org is unknown", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await countScansInWindow("acme", WEEK)).toBe(0);
    mockIsDbConfigured.mockReturnValue(true);
    orgRow = null;
    expect(await countScansInWindow("nope", WEEK)).toBe(0);
  });
});
