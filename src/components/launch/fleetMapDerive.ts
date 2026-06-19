import type { Constellation, RepoStar } from "./fleetMapStars";

export type SortKey = "name" | "maturity" | "repos" | "movement";

export interface FleetStats {
  orgs: number;
  loaded: number;
  repos: number;
  scanned: number;
  /** Mean overall maturity over SCANNED repos, or null when nothing is scanned (never NaN/0). */
  avg: number | null;
  risers: number;
  fallers: number;
}

/** Fleet-wide header tallies that visibly climb as each org's data streams in. Pure.
 *  Only `done` orgs contribute repos/scores; `avg` is null (not NaN/0) when `scanned === 0`;
 *  a repo counts as a riser at `dOverall >= 1` and a faller at `dOverall <= -1` (0.5 counts as neither). */
export function fleetStats(constellations: Constellation[]): FleetStats {
  let repos = 0;
  let scanned = 0;
  let sum = 0;
  let loaded = 0;
  let risers = 0;
  let fallers = 0;
  for (const c of constellations) {
    if (c.status === "done") {
      loaded += 1;
      repos += c.repos.length;
      for (const r of c.repos) {
        if (r.overall != null) {
          scanned += 1;
          sum += r.overall;
        }
        if (r.dOverall != null && r.dOverall >= 1) risers += 1;
        else if (r.dOverall != null && r.dOverall <= -1) fallers += 1;
      }
    }
  }
  return {
    orgs: constellations.length,
    loaded,
    repos,
    scanned,
    avg: scanned ? Math.round(sum / scanned) : null,
    risers,
    fallers,
  };
}

/** Build the star-dimming predicate for ConstellationField. When no filter is active the matcher is
 *  `undefined`, so every star renders at full brightness (no dimming). A star matches only when it
 *  passes EVERY active filter; a null-level star is treated as the `"unscanned"` band. Pure. */
export function makeMatcher({
  q,
  levels,
  watchedOnly,
}: {
  q: string;
  levels: Set<string>;
  watchedOnly: boolean;
}): ((r: RepoStar) => boolean) | undefined {
  const filterActive = q !== "" || levels.size > 0 || watchedOnly;
  if (!filterActive) return undefined;
  return (r: RepoStar) => {
    if (q && !r.fullName.toLowerCase().includes(q)) return false;
    if (watchedOnly && !r.watched) return false;
    if (levels.size > 0 && !levels.has(r.level ?? "unscanned")) return false;
    return true;
  };
}

/** Order the org cards by the chosen key. `done` constellations always rank ahead of loading/error
 *  ones (regardless of sortKey); within the `done` group, `name` sorts by login A→Z and
 *  maturity/repos/movement sort high→low by their per-org metric. Returns a new array. Pure. */
export function orderConstellations(constellations: Constellation[], sortKey: SortKey): Constellation[] {
  const metric = (c: Constellation): number => {
    if (c.status !== "done") return -1;
    const scored = c.repos.filter((r) => r.overall != null);
    if (sortKey === "repos") return c.repos.length;
    if (sortKey === "movement") return c.repos.reduce((s, r) => s + Math.abs(r.dOverall ?? 0), 0);
    if (sortKey === "maturity") return scored.length ? scored.reduce((s, r) => s + (r.overall ?? 0), 0) / scored.length : 0;
    return 0; // name handled below
  };
  return [...constellations].sort((a, b) => {
    const da = a.status === "done" ? 0 : 1;
    const db = b.status === "done" ? 0 : 1;
    if (da !== db) return da - db; // done first
    if (sortKey === "name") return a.login.localeCompare(b.login);
    return metric(b) - metric(a); // maturity / repos / movement: high to low
  });
}
