// "The latest scan per repo, under a bound", as a real SQL GROUP BY rather than a nested `take`.
//
// getOrgRollup (current snapshot + period baseline) and getOrgMovers (pre-start baseline, and the
// unwindowed "last two scans") all need one or two scans per repo. Their old shapes were a nested
// `scans: { orderBy desc, take: N }` or `distinct: ["repoId"]`, and under Prisma's client query
// compiler NEITHER reaches the SQL: the statement carries no LIMIT and no DISTINCT ON, so the org's
// whole scan history crossed the wire to keep one row per repo (economics-1, executive-briefing-export
// council r1; measured in getOrgBacklog's header, org-insights.ts). This module is that measured fix,
// shared so the three call sites cannot drift:
//
//   1. `latestScanAtPerRepo` — `groupBy repoId, _max scannedAt` under the caller's bound: one row per repo;
//   2. `atPairs`             — fetch only the scans AT those (repoId, scannedAt) pairs;
//   3. `pickLatestPerRepo`   — collapse ties to one scan per repo.
//
// TIE RULE (stated once, here): the latest `scannedAt` wins; between scans of one repo with an EQUAL
// `scannedAt`, the one with the lexicographically GREATEST `id` wins. Scan ids are uuids, so this is
// arbitrary with respect to write order, but it is deterministic: it no longer depends on the order the
// database happens to return rows in, which is all the nested `take` ever had.

import type { Prisma } from "@prisma/client";
import type { getPrisma } from "@/lib/db/client";

type Db = ReturnType<typeof getPrisma>;

/** One repo's latest `scannedAt` under a bound. */
export interface LatestScanAt {
  repoId: string;
  scannedAt: Date;
}

/**
 * Step 1: each repo's latest `scannedAt` matching `where`, as one GROUP BY statement (no history).
 * CONTRACT: `where` constrains only the repo (scope) and `scannedAt` (bound). Step 2 fetches by pair
 * alone, which is exact under that contract: every scan of a matching repo at the group's max
 * `scannedAt` matches `where` too. A filter on any other column would let a tie pull in a row it excludes.
 */
export async function latestScanAtPerRepo(prisma: Db, where: Prisma.ScanWhereInput): Promise<LatestScanAt[]> {
  const grouped = await prisma.scan.groupBy({ by: ["repoId"], where, _max: { scannedAt: true } });
  return grouped
    .filter((g): g is typeof g & { _max: { scannedAt: Date } } => g._max.scannedAt != null)
    .map((g) => ({ repoId: g.repoId, scannedAt: g._max.scannedAt }));
}

/**
 * Each repo's latest `scannedAt` STRICTLY before its own `pairs` instant — the second-most-recent scan
 * time when `pairs` are the latest. One GROUP BY; empty input issues no statement.
 */
export async function scanAtBeforePerRepo(prisma: Db, pairs: readonly LatestScanAt[]): Promise<LatestScanAt[]> {
  if (pairs.length === 0) return [];
  return latestScanAtPerRepo(prisma, { OR: pairs.map((p) => ({ repoId: p.repoId, scannedAt: { lt: p.scannedAt } })) });
}

/** Step 2: the `where` that fetches exactly the scans at those pairs. Callers skip the read when empty. */
export function atPairs(pairs: readonly LatestScanAt[]): Prisma.ScanWhereInput {
  return { OR: pairs.map((p) => ({ repoId: p.repoId, scannedAt: p.scannedAt })) };
}

type Pickable = { id: string; repoId: string; scannedAt: Date };

/** The TIE RULE as a comparator: latest `scannedAt` first, then greatest `id` first. */
export function latestFirst(a: Pickable, b: Pickable): number {
  const dt = b.scannedAt.getTime() - a.scannedAt.getTime();
  if (dt !== 0) return dt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Step 3: one scan per repo — the latest by {@link latestFirst} — whatever order `rows` arrive in. */
export function pickLatestPerRepo<T extends Pickable>(rows: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const held = out.get(r.repoId);
    if (!held || latestFirst(r, held) < 0) out.set(r.repoId, r);
  }
  return out;
}

/**
 * Steps 1-3 for a caller whose fetch needs only scalar columns plus the relation selects it names. A
 * constant two statements whatever the fleet's size or age; the second is skipped when no repo has a
 * scan under the bound.
 */
export async function readLatestScanPerRepo<S extends Prisma.ScanSelect & { id: true; repoId: true; scannedAt: true }>(
  prisma: Db,
  where: Prisma.ScanWhereInput,
  select: S,
): Promise<Map<string, Prisma.ScanGetPayload<{ select: S }>>> {
  const pairs = await latestScanAtPerRepo(prisma, where);
  if (pairs.length === 0) return new Map();
  const rows = (await prisma.scan.findMany({ where: atPairs(pairs), select })) as unknown as (Prisma.ScanGetPayload<{ select: S }> & Pickable)[];
  return pickLatestPerRepo(rows);
}
