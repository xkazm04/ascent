import type { Constellation, RepoStar } from "./fleetMapStars";

export type SortKey = "name" | "maturity" | "repos" | "movement";

export interface FleetStats {
  orgs: number;
  /** Orgs that reached `done` (contribute repos/scores). */
  loaded: number;
  /** Orgs that reached `error` (permanently failed to load — never become `done`). */
  errored: number;
  /** Orgs in a TERMINAL state (`done` OR `error`) = loaded + errored. Hydration is complete when
   *  settled === orgs; keying "still hydrating" off `loaded` alone sticks forever if any org errors. */
  settled: number;
  repos: number;
  scanned: number;
  /** Mean overall maturity over SCANNED repos, or null when nothing is scanned (never NaN/0). */
  avg: number | null;
  risers: number;
  fallers: number;
}

/** Fleet-wide header tallies that visibly climb as each org's data streams in. Pure.
 *  Only `done` orgs contribute repos/scores; `avg` is null (not NaN/0) when `scanned === 0`;
 *  a repo counts as a riser at `dOverall >= 1` and a faller at `dOverall <= -1` (0.5 counts as neither).
 *  `errored`/`settled` let the header TERMINATE: an `error` org never reaches `done`, so hydration must
 *  key off terminal state (done OR error), not success (`loaded`), or the "charting…" pill sticks forever
 *  (launch-fleet-map #1). */
export function fleetStats(constellations: Constellation[]): FleetStats {
  let repos = 0;
  let scanned = 0;
  let sum = 0;
  let loaded = 0;
  let errored = 0;
  let risers = 0;
  let fallers = 0;
  for (const c of constellations) {
    if (c.status === "error") errored += 1;
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
    errored,
    settled: loaded + errored,
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

/** How many repos a SINGLE-org fleet needs before the triage controls are worth showing. The controls
 *  used to require `constellations.length > 1`, which left a one-org user with 300 repos — the person
 *  who needs search MOST — with no search box at all. Below this the whole field fits in a glance and
 *  the controls are just chrome. */
export const TRIAGE_MIN_REPOS = 8;

/** Should the fleet triage controls render? Yes for any multi-org fleet (the grid is already busy),
 *  and yes for a single org once its constellation is dense enough to need triage. Pure. */
export function showTriageControls(orgs: number, repos: number): boolean {
  if (orgs === 0) return false;
  if (orgs > 1) return true;
  return repos >= TRIAGE_MIN_REPOS;
}

export interface MatchCount {
  /** Repos passing the active filter. */
  matched: number;
  /** Repos in the fleet that the filter was applied to. */
  total: number;
}

/** Tally how many of the fleet's repos the active filter matches. Filters DIM rather than remove, so a
 *  zero-match query renders as a uniformly faded field — pixel-identical to "everything is dim because
 *  everything scored low". Counting lets the UI say so in words. `matcher === undefined` means no filter
 *  is active, in which case everything matches by definition. Only `done` orgs hold repos. Pure. */
export function countMatches(
  constellations: Constellation[],
  matcher: ((r: RepoStar) => boolean) | undefined,
): MatchCount {
  let matched = 0;
  let total = 0;
  for (const c of constellations) {
    if (c.status !== "done") continue;
    for (const r of c.repos) {
      total += 1;
      if (!matcher || matcher(r)) matched += 1;
    }
  }
  return { matched, total };
}

/** The /launch greeting. This page's ONLY entry moment is the OAuth callback — for most visitors that
 *  is their FIRST ever sign-in, so "Welcome back" greeted a brand-new user like a returning one. Fleet
 *  framing works for both: it states what they are looking at rather than guessing their history.
 *  Returns a null `name` when the viewer has no usable display name, so the heading degrades to plain
 *  "Your fleet" instead of a dangling comma. Pure. */
export function fleetGreeting(userName: string | null | undefined): { lead: string; name: string | null } {
  const name = (userName ?? "").trim();
  return { lead: "Your fleet", name: name === "" ? null : name };
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
