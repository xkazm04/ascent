// `listLoopRuns` as the ledger's CHRONICLE reads it: stable run numbers, a `beforeSeq` cursor that
// pages by number (never by offset), and the per-run closes / landings / lane counts folded out of the
// SAME one lanes read the lift comes from. Over a Prisma fake that records the query shapes, so "pages
// by seq" is about the where/orderBy actually sent.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({ runs: [] as Row[], lanes: [] as Row[], runQueries: [] as Row[], scans: [] as Row[], scanQueries: [] as Row[] }));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  dbReadSafe: async <T,>(fn: () => Promise<T>) => fn(),
  getPrisma: () => ({
    loopRun: {
      findMany: async (q: { where: { orgId: string; seq?: { lt: number } }; orderBy: Row; take: number }) => {
        h.runQueries.push(q);
        let hit = h.runs.filter((r) => r.orgId === q.where.orgId);
        if (q.where.seq) hit = hit.filter((r) => typeof r.seq === "number" && (r.seq as number) < q.where.seq!.lt);
        hit.sort((a, b) => ("seq" in q.orderBy ? (b.seq as number) - (a.seq as number) : (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime()));
        return hit.slice(0, q.take);
      },
    },
    loopRunLane: {
      findMany: async ({ where }: { where: { runId: { in: string[] } } }) => h.lanes.filter((l) => where.runId.in.includes(l.runId as string)),
    },
    scan: {
      findMany: async (q: { where: { id: { in: string[] } } }) => {
        h.scanQueries.push(q);
        return h.scans.filter((sc) => q.where.id.in.includes(sc.id as string));
      },
    },
  }),
}));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: async (slug: string) => (slug === "acme" ? { id: "org-acme" } : null), dateRange: () => ({}) }));
vi.mock("@/lib/db/scans-read", () => ({ getScanComparison: async () => null }));
vi.mock("@/lib/db/lane-outcomes", () => ({ listRunOutcomes: async () => [] }));

import { listLoopRuns } from "./loop-runs-read";

const run = (seq: number | null, over: Row = {}): Row => ({
  id: `run-${seq ?? "x"}`,
  orgId: "org-acme",
  createdBy: null,
  phase: "done",
  reposJson: JSON.stringify(["acme/web"]),
  concurrency: 2,
  maxCycles: 3,
  cycle: 1,
  curated: false,
  model: null,
  effort: null,
  modelPolicy: "single",
  modelsJson: "[]",
  delivery: null,
  batchSize: null,
  agentTimeoutMs: null,
  verifyMode: null,
  verifyTimeoutMs: null,
  seq,
  driveId: seq === 3 ? "drive_1" : null,
  planMode: seq === 3 ? "on" : null,
  startedAt: new Date(Date.UTC(2026, 8, seq ?? 1)),
  endedAt: new Date(Date.UTC(2026, 8, seq ?? 1, 1)),
  error: null,
  createdAt: new Date(Date.UTC(2026, 8, seq ?? 1)),
  ...over,
});
const lane = (runId: string, closed: string[], landedAt: Date | null): Row => ({
  runId,
  beforeScanId: null,
  afterScanId: null,
  commits: 1,
  costMicros: null,
  closedIdsJson: JSON.stringify(closed),
  landedAt,
});

beforeEach(() => {
  h.runQueries = [];
  h.scanQueries = [];
  h.scans = [];
  h.runs = [1, 2, 3, 4, 5].map((n) => run(n));
  h.lanes = [
    lane("run-3", ["a", "b"], new Date("2026-09-03T00:30:00Z")),
    lane("run-3", ["c"], null),
    lane("run-5", [], null),
  ];
});

describe("listLoopRuns — the chronicle", () => {
  it("keeps the first page newest-first by creation, exactly as before", async () => {
    const runs = await listLoopRuns("acme", 2);
    expect(runs.map((r) => r.seq)).toEqual([5, 4]);
    expect(h.runQueries[0]).toMatchObject({ where: { orgId: "org-acme" }, orderBy: { createdAt: "desc" }, take: 2 });
  });

  it("pages BELOW a stable number, ordered by that number — no offset to drift when a run lands", async () => {
    const runs = await listLoopRuns("acme", 2, { beforeSeq: 4 });
    expect(runs.map((r) => r.seq)).toEqual([3, 2]);
    expect(h.runQueries[0]).toMatchObject({ where: { orgId: "org-acme", seq: { lt: 4 } }, orderBy: { seq: "desc" } });
    // A new run arriving between pages changes nothing about the next page.
    h.runs.push(run(6));
    expect((await listLoopRuns("acme", 2, { beforeSeq: 2 })).map((r) => r.seq)).toEqual([1]);
  });

  it("carries the run number, its drive, its plan mode and the lanes' closes and landings", async () => {
    const [r3] = await listLoopRuns("acme", 1, { beforeSeq: 4 });
    expect(r3).toMatchObject({
      id: "run-3",
      seq: 3,
      driveId: "drive_1",
      planMode: "on",
      lanes: 2,
      verifiedCloses: 3,
      landedAt: ["2026-09-03T00:30:00.000Z"],
      error: null,
    });
    // The summary fields every existing caller reads are all still there.
    expect(r3).toMatchObject({ phase: "done", repos: ["acme/web"], cycle: 1, maxCycles: 3, lift: null, costMicros: null });
  });

  it("reads a run with no lanes as zero lanes, zero closes and no landings", async () => {
    const [r4] = await listLoopRuns("acme", 1, { beforeSeq: 5 });
    expect(r4).toMatchObject({ seq: 4, lanes: 0, verifiedCloses: 0, landedAt: [] });
  });

  it("ignores a null cursor and reads another org as nothing", async () => {
    expect((await listLoopRuns("acme", 20, { beforeSeq: null })).length).toBe(5);
    expect(await listLoopRuns("other", 20)).toEqual([]);
  });

  // The lift answers to the attribution rule, and the rule refuses a pair scored under two different
  // rubrics: a rubric bump between the before and after scans is the ruler moving, not the lane's work.
  it("a lane whose two scans were scored under different rubrics adds nothing to the run's lift", async () => {
    const sc = (id: string, overallScore: number, rubricVersion: string | null) => ({ id, overallScore, engineProvider: "claude-cli", engineDegraded: false, rubricVersion });
    h.scans = [sc("b1", 60, "r17"), sc("a1", 70, "r18"), sc("b2", 60, "r18"), sc("a2", 70, "r18")];
    h.lanes = [
      { ...lane("run-3", [], null), beforeScanId: "b1", afterScanId: "a1", commits: 3 },
      { ...lane("run-5", [], null), beforeScanId: "b2", afterScanId: "a2", commits: 3 },
    ];
    const runs = await listLoopRuns("acme", 5);
    expect(runs.find((r) => r.id === "run-3")!.lift).toBeNull();
    expect(runs.find((r) => r.id === "run-5")!.lift).toBe(10);
    expect(h.scanQueries[0]).toMatchObject({ select: { rubricVersion: true } });
  });
});
