// economics-1: the bounded latest-scan reads return the SAME rows the old shape did.
//
// getOrgRollup and getOrgMovers used to take each repo's latest scan(s) with a nested `take` or with
// `distinct`, which Prisma applies after fetching the org's whole history. They now take it as
// `groupBy repoId, _max scannedAt` + a fetch by (repoId, scannedAt). The fixture gives every repo several
// scans before the window start, inside the window and after its end (plus a repo seen only after it, a
// repo onboarded inside it, and a mock-scored baseline), and the OLD shape is the oracle: each read must
// return exactly the rows it would have kept, while transferring a fraction of the rows it fetched.
// The query plan itself is pinned in org-rollup-queries.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({ mockIsDbConfigured: vi.fn(), mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));

import { computeCohortMovement, getOrgRollup, isMockScore } from "./org-rollup";
import { getOrgMovers } from "./org-insights";
import { latestFirst, pickLatestPerRepo } from "./org-rollup-latest-scans";
import { fleetPrisma, makeFleet, oldPick, oldTransfer, type Fleet, type FleetScan, type Read } from "./org-rollup-latest-scans.test-helpers";

const START = new Date("2026-04-01T00:00:00Z");
const END_X = new Date("2026-07-01T00:00:00Z");
const WINDOW = { start: START, endExclusive: END_X };

function fixture(): Fleet {
  const fleet = makeFleet(40, 30); // 2025-10-01 → 2026-10-24: before, inside and after the window
  const scan = (repoId: string, iso: string, overallScore: number, j: number): FleetScan => ({
    id: `${repoId}-s${j}`, repoId, scannedAt: new Date(iso), overallScore, adoptionScore: overallScore,
    rigorScore: overallScore, level: "L2", posture: "developing", engineProvider: "anthropic",
  });
  fleet.repos.push({ id: "late", fullName: "acme/late", name: "late" }, { id: "new", fullName: "acme/new", name: "new" });
  // Seen only AFTER the window end: no current scan under the bound, no baseline.
  fleet.scans.push(scan("late", "2026-08-03T00:00:00Z", 61, 0), scan("late", "2026-09-03T00:00:00Z", 64, 1));
  // Onboarded inside the window: a current scan, no baseline.
  fleet.scans.push(scan("new", "2026-04-20T00:00:00Z", 30, 0), scan("new", "2026-05-20T00:00:00Z", 45, 1));
  // r001's latest pre-start scan is the mock floor: read like any row, then excluded from the cohort.
  const r001Base = oldPick(fleet, { lt: START }).get("r001")![0]!;
  r001Base.engineProvider = "mock";
  return fleet;
}

const ids = (m: Map<string, FleetScan[]>) => [...m.values()].flat().map((s) => s.id).sort();
/** The rows each latest-scan pair fetch returned (a `scan.findMany` whose where is an OR of pairs). */
const pairFetches = (reads: Read[]) =>
  reads.filter((r) => r.target === "scan.findMany" && "OR" in ((r.args.where as object) ?? {})).map((r) => r.rows as FleetScan[]);
const rowIds = (rows: FleetScan[]) => rows.map((s) => s.id).sort();

async function run<T>(fleet: Fleet, call: () => Promise<T>) {
  const fake = fleetPrisma(fleet);
  mockGetPrisma.mockReturnValue(fake.prisma);
  return { result: await call(), reads: fake.reads };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("getOrgRollup — the bounded reads keep exactly the rows the nested take / distinct kept", () => {
  it("windowed: the current snapshot (lt end) and the baseline (lt start) are the old picks, row for row", async () => {
    const fleet = fixture();
    const { result, reads } = await run(fleet, () => getOrgRollup("acme", WINDOW));
    const [current, baseline] = pairFetches(reads);
    expect(rowIds(current!)).toEqual(ids(oldPick(fleet, { lt: END_X })));
    expect(rowIds(baseline!)).toEqual(ids(oldPick(fleet, { lt: START })));

    // …and so the rollup states the same fleet: each repo's latest, and the cohort movement over them.
    const oldCurrent = oldPick(fleet, { lt: END_X });
    for (const r of result!.repos) {
      const want = oldCurrent.get(r.fullName.split("/")[1]!)?.[0];
      expect([r.fullName, r.latest?.scannedAt ?? null]).toEqual([r.fullName, want ? want.scannedAt.toISOString() : null]);
    }
    const snaps = (m: Map<string, FleetScan[]>) =>
      [...m.values()].map((v) => v[0]!).filter((s) => !isMockScore(s.engineProvider))
        .map((s) => ({ repoId: s.repoId, overall: s.overallScore, adoption: s.adoptionScore, rigor: s.rigorScore }));
    expect(result!.movement).toEqual(computeCohortMovement(snaps(oldCurrent), snaps(oldPick(fleet, { lt: START }))));
    expect(result!.baseline!.repos).toBe(snaps(oldPick(fleet, { lt: START })).length);
  });

  it("all time: the current snapshot is each repo's newest scan", async () => {
    const fleet = fixture();
    const { reads } = await run(fleet, () => getOrgRollup("acme"));
    expect(pairFetches(reads).map(rowIds)).toEqual([ids(oldPick(fleet, undefined))]);
  });
});

describe("getOrgMovers — the bounded reads keep exactly the rows distinct / take 2 kept", () => {
  it("windowed: the pre-start baseline is the old distinct pick, and every period move is measured from it", async () => {
    const fleet = fixture();
    const { result, reads } = await run(fleet, () => getOrgMovers("acme", WINDOW));
    expect(pairFetches(reads).map(rowIds)).toEqual([ids(oldPick(fleet, { lt: START }))]);

    const base = oldPick(fleet, { lt: START });
    const now = oldPick(fleet, { gte: START, lt: END_X });
    const moves = [...result!.gainers, ...result!.regressers, ...result!.held];
    expect(moves.length).toBeGreaterThan(10);
    for (const m of moves) {
      const id = m.fullName.split("/")[1]!;
      expect([id, m.dOverall]).toEqual([id, now.get(id)![0]!.overallScore - base.get(id)![0]!.overallScore]);
    }
    expect(result!.onboarded.map((m) => m.fullName)).toEqual(["acme/new"]);
  });

  it("since last scan: the pair fetch holds exactly each repo's two newest scans (the old take 2)", async () => {
    const fleet = fixture();
    const { result, reads } = await run(fleet, () => getOrgMovers("acme"));
    expect(pairFetches(reads).map(rowIds)).toEqual([ids(oldPick(fleet, undefined, 2))]);
    const two = oldPick(fleet, undefined, 2);
    for (const m of [...result!.gainers, ...result!.regressers, ...result!.held]) {
      const [now, prev] = two.get(m.fullName.split("/")[1]!)!;
      expect(m.dOverall).toBe(now!.overallScore - prev!.overallScore);
    }
  });
});

describe("row volume — what crosses the wire tracks the fleet's size, not its age", () => {
  it("transfers one row per repo per pick where the old shape transferred the history under the bound", async () => {
    const fleet = fixture(); // 42 repos, 1,204 scans
    const { reads } = await run(fleet, () => getOrgRollup("acme", WINDOW));
    const picked = reads.filter((r) => r.target === "scan.groupBy" || pairFetches([r]).length).reduce((n, r) => n + r.rows.length, 0);
    // Old: every scan under the window end (current: 40 × 23 + 2) plus every scan before start (baseline:
    // 40 × 16), fetched to keep one each. New: 81 grouped rows (41 current + 40 baseline) and those 81 rows.
    const old = oldTransfer(fleet, { lt: END_X }) + oldTransfer(fleet, { lt: START });
    expect({ old, picked }).toEqual({ old: 1562, picked: 162 });
  });
});

describe("the tie rule — an equal scannedAt resolves to the greatest id, whatever order rows arrive in", () => {
  const at = new Date("2026-05-01T00:00:00Z");
  const tied = (id: string) => ({ id, repoId: "r", scannedAt: at });

  it("pickLatestPerRepo and latestFirst agree, in every arrival order", () => {
    const rows = [tied("b"), tied("c"), tied("a"), { id: "z", repoId: "r", scannedAt: new Date("2026-04-01T00:00:00Z") }];
    for (const order of [rows, [...rows].reverse(), [rows[2]!, rows[0]!, rows[3]!, rows[1]!]]) {
      expect(pickLatestPerRepo(order).get("r")!.id).toBe("c");
      expect([...order].sort(latestFirst).map((r) => r.id)).toEqual(["c", "b", "a", "z"]);
    }
  });

  it("getOrgRollup reports the same latest scan however the table orders two tied scans", async () => {
    const pick = async (reverse: boolean) => {
      const fleet = makeFleet(1, 3);
      const last = fleet.scans[2]!;
      fleet.scans.push({ ...last, id: `${last.id}-dup`, overallScore: (last.overallScore + 40) % 100 });
      if (reverse) fleet.scans.reverse();
      return (await run(fleet, () => getOrgRollup("acme"))).result!.repos[0]!.latest!.overall;
    };
    // The duplicate id sorts after the original ("…-dup" > "…"), so it is the one kept, in both orders.
    expect(await pick(false)).toBe(await pick(true));
    expect(await pick(false)).toBe((makeFleet(1, 3).scans[2]!.overallScore + 40) % 100);
  });
});
