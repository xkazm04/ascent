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
//
// THE DOOR (rollups-0, challenge-2026-10-22): three call sites adopting it did not stop the drift -
// fifteen other fleet readers kept the nested shape. Every src/lib/db/org-*.ts reader now asks through
// `withLatestScans` (bottom of this file), and src/lib/db/org-latest-scan-guard.test.ts fails on a
// nested `scans: { take }` anywhere under src/lib/db/org-*.ts (org-benchmark.ts allowlisted, with why).

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

/**
 * The latest TWO scans per repo (newest first, by {@link latestFirst}) under a bound: the shape a
 * "since last scan" delta needs. Three constant statements - the latest pick, the pick strictly before
 * it ({@link scanAtBeforePerRepo}), one pair fetch of both - never a nested `take: 2`, which like
 * `take: 1` is applied after the fetch and so transfers the org's entire history.
 */
export async function readLatestTwoScansPerRepo<S extends Prisma.ScanSelect & { id: true; repoId: true; scannedAt: true }>(
  prisma: Db,
  where: Prisma.ScanWhereInput,
  select: S,
): Promise<Map<string, Prisma.ScanGetPayload<{ select: S }>[]>> {
  const latest = await latestScanAtPerRepo(prisma, where);
  if (latest.length === 0) return new Map();
  const before = await scanAtBeforePerRepo(prisma, latest);
  const rows = (await prisma.scan.findMany({ where: atPairs([...latest, ...before]), select })) as unknown as (Prisma.ScanGetPayload<{ select: S }> & Pickable)[];
  const out = new Map<string, (Prisma.ScanGetPayload<{ select: S }> & Pickable)[]>();
  for (const r of [...rows].sort(latestFirst)) {
    const held = out.get(r.repoId) ?? [];
    if (held.length < 2) out.set(r.repoId, [...held, r]);
  }
  return out;
}

/** The scan columns the door always fetches (it needs them to pick), merged into a caller's select. */
type DoorSelect<S extends Prisma.ScanSelect> = S & { id: true; repoId: true; scannedAt: true };

/**
 * THE DOOR for a fleet reader that wants "each repo's latest scan" beside its repository read: the
 * repository rows come back carrying `scans: [latest]` (or `[latest, previous]` with `take: 2`, or
 * `[]` for a never-scanned repo), so the code below a call site reads the shape it always did.
 *
 * `repos` is the caller's own repository read, already started (it must select `id`); `scope` is the
 * SAME repository where-fragment (org + segment/stack slice), applied to the scan pick through the
 * relation so the two reads run in parallel. Nothing here filters on a scan column, which is what keeps
 * {@link latestScanAtPerRepo}'s contract: a filter such as "latest LIVE scan" belongs to the caller,
 * AFTER the pick (a mock-latest repo is dropped, not swapped for an older live scan).
 *
 * src/lib/db/org-latest-scan-guard.test.ts forbids a nested `scans: { take }` under src/lib/db/org-*.ts,
 * so this is the only way left to ask the question.
 */
export async function withLatestScans<R extends { id: string }, S extends Prisma.ScanSelect>(
  prisma: Db,
  repos: Promise<R[]>,
  scope: Prisma.RepositoryWhereInput,
  select: S,
  opts: { take?: 1 | 2 } = {},
): Promise<(R & { scans: Prisma.ScanGetPayload<{ select: DoorSelect<S> }>[] })[]> {
  const full = { ...select, id: true, repoId: true, scannedAt: true } as DoorSelect<S>;
  const where: Prisma.ScanWhereInput = { repo: scope };
  const [rows, byRepo] = await Promise.all([
    repos,
    opts.take === 2
      ? readLatestTwoScansPerRepo(prisma, where, full)
      : readLatestScanPerRepo(prisma, where, full).then((m) => new Map([...m].map(([k, v]) => [k, [v]]))),
  ]);
  return rows.map((r) => ({ ...r, scans: byRepo.get(r.id) ?? [] }));
}
