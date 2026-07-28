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

/** Sum and count of `overall` among repos that HAVE one. The shared core of every "mean overall score"
 *  computed on the fleet map (fleetStats' fleet-wide average, ConstellationField's per-org average, and
 *  orderConstellations's maturity sort key) — factored out here so the three can't silently drift into
 *  disagreeing definitions of "mean". (They were checked: all three already summed/counted the same
 *  non-null repos — no numeric divergence — they just differed in SCOPE (fleet-wide vs per-org) and in
 *  whether the result gets rounded, which is why rounding stays a caller decision below rather than
 *  living in this function.) */
export function sumScoredOverall(repos: readonly RepoStar[]): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const r of repos) {
    if (r.overall != null) {
      sum += r.overall;
      count += 1;
    }
  }
  return { sum, count };
}

/** Round a `sumScoredOverall` tally to a displayable mean, or null when nothing is scored (never
 *  NaN/0). Rounding lives here — separated from `sumScoredOverall` — because orderConstellations'
 *  maturity sort key needs the UNROUNDED mean (rounding two close-but-distinct means to the same
 *  integer would flip their sort order depending on float noise; a sort key must stay precise even
 *  though the same number gets rounded for display elsewhere). */
export function roundedMean(sum: number, count: number): number | null {
  return count > 0 ? Math.round(sum / count) : null;
}

/** Mean `overall` over a list of repos, rounded for display; null when none are scored. Thin
 *  composition of `sumScoredOverall` + `roundedMean` for call sites (like ConstellationField) that want
 *  a per-org display average in one call. */
export function meanOverall(repos: readonly RepoStar[]): number | null {
  const { sum, count } = sumScoredOverall(repos);
  return roundedMean(sum, count);
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
      const scored = sumScoredOverall(c.repos);
      scanned += scored.count;
      sum += scored.sum;
      for (const r of c.repos) {
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
    avg: roundedMean(sum, scanned),
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
    if (sortKey === "repos") return c.repos.length;
    if (sortKey === "movement") return c.repos.reduce((s, r) => s + Math.abs(r.dOverall ?? 0), 0);
    if (sortKey === "maturity") {
      // Same sumScoredOverall tally as fleetStats/ConstellationField, deliberately left UNROUNDED here:
      // this is a sort key, not a displayed number, and rounding it could flip the order of two orgs
      // whose true means are close but distinct (a visible reorder, not just a redraw).
      const { sum, count } = sumScoredOverall(c.repos);
      return count ? sum / count : 0;
    }
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
