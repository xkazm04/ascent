// "Scan what you filtered": the fleet map's triage match set as a plan of scoped per-org scans. Pure.
//
// The route (POST /api/org/scan) intersects `repos:[...]` with the org's watchlist and scans the WHOLE
// watchlist when `repos` is empty, so the plan:
//   - carries only matched WATCHED repos (an unwatched match would be dropped server-side, silently;
//     here it is counted up front instead),
//   - never holds a run with an empty scope (that would widen to every watched repo),
//   - reads every repo of a `done` org, not only the MAX_STARS drawn: a filter is the only way to
//     reach the undrawn stars from the map, so it must be able to act on them too.

import type { Constellation, RepoStar } from "./fleetMapStars";

export interface ScopeRun {
  org: string;
  /** Full names, as the route matches them. Never empty. */
  repos: string[];
}

export interface ScopePlan {
  /** One scoped scan per org, in map order. */
  runs: ScopeRun[];
  /** Repos the plan will scan (each draws at most one scan credit). */
  scanCount: number;
  /** Matches the plan will NOT scan because they are not on their org's watchlist. */
  excludedUnwatched: number;
  /** Set when there is a match but nothing scannable: the action renders disabled with this reason. */
  reason?: "none-watched";
}

/** The plan for the current filter: null when no filter is active (the per-org Scan is the unfiltered
 *  path) or when nothing matches (the match count already says so). Loading/error orgs hold no repos. */
export function scopePlan(
  constellations: Constellation[],
  matcher: ((r: RepoStar) => boolean) | undefined,
): ScopePlan | null {
  if (!matcher) return null;
  const runs: ScopeRun[] = [];
  let scanCount = 0;
  let excludedUnwatched = 0;
  for (const c of constellations) {
    if (c.status !== "done") continue;
    const repos: string[] = [];
    for (const r of c.repos) {
      if (!matcher(r)) continue;
      if (r.watched) repos.push(r.fullName);
      else excludedUnwatched += 1;
    }
    if (repos.length > 0) {
      runs.push({ org: c.login, repos });
      scanCount += repos.length;
    }
  }
  if (scanCount === 0 && excludedUnwatched === 0) return null;
  return scanCount === 0 ? { runs, scanCount, excludedUnwatched, reason: "none-watched" } : { runs, scanCount, excludedUnwatched };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The action's own text: what it will scan, and what it will not. The number names what it counts. */
export function scopeLabel(plan: ScopePlan): string {
  const tail = plan.excludedUnwatched > 0 ? ` · ${plan.excludedUnwatched} unwatched not scanned` : "";
  if (plan.scanCount === 0) return `No watched repo matches${tail}`;
  const orgs = plural(plan.runs.length, "org", "orgs");
  return `Scan ${plural(plan.scanCount, "matching watched repo", "matching watched repos")} (${orgs})${tail}`;
}

/** What the run will draw, said before it starts; or, when disabled, how to make a match scannable. */
export function scopeDrawNote(plan: ScopePlan): string {
  if (plan.scanCount === 0) return "Only watched repos can be scanned from the map. Watch a repo in its org first.";
  return `Draws up to ${plural(plan.scanCount, "scan credit", "scan credits")}, one per repo, one org at a time.`;
}

/** The per-org Scan lock: one scan at a time, and none while a scoped plan runs (even between its runs). */
export function scanDisabledFor(login: string, scanning: string | null, planActive: boolean): boolean {
  return planActive || (scanning !== null && scanning !== login);
}
