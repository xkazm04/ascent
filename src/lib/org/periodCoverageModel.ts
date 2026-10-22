// The in-period coverage of a windowed fleet rollup. `getOrgRollup`'s "current" is each repo's latest
// scan at-or-before the window's upper bound with NO lower bound (src/lib/org/period.ts), so a repo
// last scored before `start` still counts in the fleet average while movers cannot see it. This
// model counts and names that carried set from the rollup rows the page already holds (no query),
// and splits it into what one click can rescan: the bulk scan route scans watched repos only
// (src/app/api/org/scan/route.ts intersects an explicit `repos` scope with the watchlist), and a repo
// with an unsettled paid rescore is already on its way, so neither belongs in the rescan set.
//
// Pure and client-safe: no db import. The mock floor ("mock" engine) is excluded from the
// population exactly as `isMockScore` in src/lib/db/org-rollup.ts excludes it from the average, so
// the total here is the denominator the average actually stands on (count-carries-predicate).

/** The structural slice of `OrgRepoRow` this model reads. */
export interface CoverageRow {
  fullName: string;
  name: string;
  watched: boolean;
  latest: { scannedAt: string; engine: string } | null;
  freshness: { queuedRescore: boolean };
}

export interface CarriedRepo {
  fullName: string;
  name: string;
  /** The scan the average is still counting (ISO). */
  lastScoredAt: string;
  /** Whole days between that scan and now. */
  ageDays: number;
  watched: boolean;
  queued: boolean;
}

/** What the strip offers: a rescan of N, or a reason there is no button. */
export type CoverageAction =
  | { state: "rescan"; count: number }
  | { state: "queued"; count: number }
  | { state: "unwatched"; count: number }
  | { state: "none" };

export interface PeriodCoverage {
  /** Live-scored repos: the fleet average's population. */
  total: number;
  /** Of those, the ones whose latest scan is inside the window. */
  inPeriod: number;
  /** The rest, oldest scan first. */
  carried: CarriedRepo[];
  /** Watched, not already queued: the exact list handed to the bulk scan. */
  rescanSet: string[];
  alreadyQueued: number;
  notWatched: number;
  action: CoverageAction;
}

const DAY_MS = 86_400_000;

export function periodCoverage(
  rows: readonly CoverageRow[],
  start: Date | null | undefined,
  nowMs: number = Date.now(),
): PeriodCoverage | null {
  if (!start) return null;
  const startMs = start.getTime();
  const scored = rows.filter((r) => r.latest && r.latest.engine !== "mock");
  const carried: CarriedRepo[] = scored
    .filter((r) => Date.parse(r.latest!.scannedAt) < startMs)
    .map((r) => ({
      fullName: r.fullName,
      name: r.name,
      lastScoredAt: r.latest!.scannedAt,
      ageDays: Math.max(0, Math.floor((nowMs - Date.parse(r.latest!.scannedAt)) / DAY_MS)),
      watched: r.watched,
      queued: r.freshness.queuedRescore,
    }))
    .sort((a, b) => Date.parse(a.lastScoredAt) - Date.parse(b.lastScoredAt) || a.fullName.localeCompare(b.fullName));
  const notWatched = carried.filter((r) => !r.watched).length;
  const alreadyQueued = carried.filter((r) => r.watched && r.queued).length;
  const rescanSet = carried.filter((r) => r.watched && !r.queued).map((r) => r.fullName);
  const action: CoverageAction =
    rescanSet.length > 0
      ? { state: "rescan", count: rescanSet.length }
      : alreadyQueued > 0
        ? { state: "queued", count: alreadyQueued }
        : notWatched > 0
          ? { state: "unwatched", count: notWatched }
          : { state: "none" };
  return { total: scored.length, inPeriod: scored.length - carried.length, carried, rescanSet, alreadyQueued, notWatched, action };
}

/** The counted caveat. Null when nothing is carried: with no split there is nothing to disclose. */
export function periodCoverageCaption({ inPeriod, total }: { inPeriod: number; total: number }): string | null {
  const n = total - inPeriod;
  if (n <= 0) return null;
  return n === 1
    ? `1 of ${total} repos has no scan this period: it counts in the fleet average from its earlier scan and does not appear in movers.`
    : `${n} of ${total} repos have no scan this period: they count in the fleet average from their earlier scan and do not appear in movers.`;
}
