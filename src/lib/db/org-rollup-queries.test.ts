// getOrgRollup's and getOrgMovers' QUERY PLAN, pinned (economics-1, executive-briefing-export council r1:
// "Every briefing build reads the org's whole scan history, and nothing in the code caps it").
//
// Both functions need one or two scans per repo. Their old shapes (a nested `scans: { take: 1 }`, a
// `take: 2`, and `distinct: ["repoId"]`) never reached the SQL under Prisma's client query compiler:
// the statement carried no LIMIT and no DISTINCT ON, so every scan the org ever took crossed the wire on
// every Org surface and every briefing build. The fix is getOrgBacklog's measured shape (its header in
// org-insights.ts; its own pin is org-insights-backlog-queries.test.ts): `groupBy repoId, _max scannedAt`,
// then a fetch of only those rows. Like that pin, this one guards what neither the UI nor the returned
// object shows:
//   1. the statement count and sequence are CONSTANT as the fleet grows in size and in age;
//   2. no read carries a nested relation `take`, and no Scan read relies on `distinct`;
//   3. every latest-per-repo pick is a real GROUP BY, under the bound its caller documents.
// Row-level equivalence with the old shape is in org-rollup-latest-scans.equivalence.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({ mockIsDbConfigured: vi.fn(), mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));

import { getOrgRollup } from "./org-rollup";
import { getOrgMovers } from "./org-insights";
import { fleetPrisma, makeFleet, type Read } from "./org-rollup-latest-scans.test-helpers";

const START = new Date("2026-04-01T00:00:00Z");
const END_X = new Date("2026-07-01T00:00:00Z");
const WINDOW = { start: START, endExclusive: END_X };

const RUNS: [string, () => Promise<unknown>][] = [
  ["getOrgRollup (windowed)", () => getOrgRollup("acme", WINDOW)],
  ["getOrgRollup (all time)", () => getOrgRollup("acme")],
  ["getOrgMovers (windowed)", () => getOrgMovers("acme", WINDOW)],
  ["getOrgMovers (since last scan)", () => getOrgMovers("acme")],
];

async function planFor(run: () => Promise<unknown>, repos: number, perRepo: number) {
  const fake = fleetPrisma(makeFleet(repos, perRepo));
  mockGetPrisma.mockReturnValue(fake.prisma);
  await run();
  return fake.reads;
}

/** Deep search for a relation `take` — the construct whose LIMIT never reaches the SQL. */
function hasNestedTake(node: unknown, atRoot = true): boolean {
  if (node == null || typeof node !== "object" || node instanceof Date) return false;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "take" && !atRoot) return true;
    if (hasNestedTake(v, false)) return true;
  }
  return false;
}

const scanReads = (reads: Read[]) => reads.filter((r) => r.target.startsWith("scan."));
const groupBys = (reads: Read[]) => reads.filter((r) => r.target === "scan.groupBy");

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
});

describe.each(RUNS)("%s — query plan", (_name, run) => {
  it("issues the same statements for 300 repos × 60 scans as for 1 repo × 25 — constant in fleet size and age", async () => {
    // 25 scans 12 days apart span 2025-10-01 → 2026-07-19: history before, inside and after the window,
    // so even the one-repo fleet exercises every read (no "nothing to fetch" short-circuit).
    const small = await planFor(run, 1, 25);
    const large = await planFor(run, 300, 60);
    expect(large.map((r) => r.target)).toEqual(small.map((r) => r.target));
  });

  it("carries no nested relation `take` on any read, and no Scan read relies on `distinct`", async () => {
    const reads = await planFor(run, 20, 30);
    for (const r of reads) expect([r.target, hasNestedTake(r.args)]).toEqual([r.target, false]);
    for (const r of scanReads(reads)) expect([r.target, "distinct" in r.args]).toEqual([r.target, false]);
    // The repository read joins no scans at all: the latest-scan pick is its own GROUP BY.
    for (const r of reads.filter((x) => x.target === "repository.findMany")) {
      expect((r.args.select as Record<string, unknown> | undefined)?.scans).toBeUndefined();
    }
  });

  it("takes every latest-per-repo pick as groupBy repoId, _max scannedAt — never more than one row per repo", async () => {
    const reads = await planFor(run, 20, 30);
    expect(groupBys(reads).length).toBeGreaterThan(0);
    for (const g of groupBys(reads)) {
      expect(g.args.by).toEqual(["repoId"]);
      expect(g.args._max).toEqual({ scannedAt: true });
      expect(g.rows.length).toBeLessThanOrEqual(20);
    }
  });
});

describe("the bounds each pick is taken under", () => {
  const bounds = async (run: () => Promise<unknown>) =>
    groupBys(await planFor(run, 5, 30)).map((g) => (g.args.where as { scannedAt?: unknown }).scannedAt ?? null);

  it("getOrgRollup: the current snapshot under the window end, the baseline strictly before start", async () => {
    expect(await bounds(() => getOrgRollup("acme", WINDOW))).toEqual([{ lt: END_X }, { lt: START }]);
    expect(await bounds(() => getOrgRollup("acme"))).toEqual([null]);
  });

  it("getOrgMovers: the baseline strictly before start; since-last-scan the latest, then the one before it", async () => {
    expect(await bounds(() => getOrgMovers("acme", WINDOW))).toEqual([{ lt: START }]);
    // The second pick is per repo (an OR of `scannedAt lt <that repo's latest>`), not a fleet-wide bound.
    const unwindowed = groupBys(await planFor(() => getOrgMovers("acme"), 5, 30));
    expect(unwindowed).toHaveLength(2);
    expect((unwindowed[1]!.args.where as { OR: unknown[] }).OR).toHaveLength(5);
  });

  it("scopes each pick to the org (and its segment/stack slice) through the relation", async () => {
    const reads = await planFor(() => getOrgRollup("acme", WINDOW, "seg_1", "grp_1"), 5, 30);
    const scoped = { orgId: "org_1", segments: { some: { segmentId: "seg_1" } }, techGroups: { some: { groupId: "grp_1" } } };
    for (const g of groupBys(reads)) expect((g.args.where as { repo: unknown }).repo).toEqual(scoped);
  });
});
