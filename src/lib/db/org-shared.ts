// Shared internals for the org-rollup family (org-*.ts). Private to the db layer — re-exported
// through org.ts only where part of the public surface; the helpers here are not. All guarded by
// DATABASE_URL at the call sites.
//
// ONE WINDOW SHAPE, DIFFERENT ENDPOINTS. `upperBound`/`dateRange` below give the whole family one
// closure convention — half-open `[start, endExclusive)`, produced for the UI by `orgWindowBounds`
// (src/lib/org/period.ts) and no longer hand-written per tab. What each reader SELECTS out of those
// bounds still differs on purpose: getOrgRollup takes each repo's latest scan at-or-before the upper
// bound with no lower bound; getOrgMovers / getOrgTeamRollup take the latest scan strictly inside the
// window; getOrgRepoHistories takes every scan in it. Bounds are shared, endpoints are each reader's
// own — stated in each reader's header, pinned by src/lib/org/period.dialect.test.ts.

import { cache } from "react";
import { getPrisma } from "@/lib/db/client";
import { IMPACT_RANK } from "@/lib/scoring/impact";

/**
 * Resolve an org by slug, memoized per server request via React `cache()`. A single dashboard render
 * fans out many fleet aggregates (rollup, movers, recommendations, benchmark, gaps, goals, …) and each
 * one used to re-issue the IDENTICAL `organization.findUnique({ where: { slug } })` — ~8–10 redundant
 * round-trips per page. Routing them all through this collapses them to one lookup per request (the
 * same per-request memo pattern getViewer uses in lib/access). Returns the full row — callers read
 * `id` and `plan` — or null when the org doesn't exist. Callers still guard isDbConfigured() first.
 *
 * Canonicalizes the slug (trim + lowercase) before the lookup: org rows are PERSISTED lower-cased (the
 * GitHub-App install flow lowercases), and this is the single resolver the whole rollup family funnels
 * through, yet most callers passed the raw slug. A mixed-case URL (`/org/MyOrg`) then passed auth (which
 * resolves via getOrgId → already normalized) but returned null/empty from every aggregate. Normalizing
 * here makes this the one canonicalization point for the family, so auth and data agree on identity.
 */
export const getOrgBySlug = cache((slug: string) => {
  return getPrisma().organization.findUnique({ where: { slug: slug.trim().toLowerCase() } });
});

export const LEVEL_RANK: Record<string, number> = { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };
/** The db layer's view of the canonical impact weights (src/lib/scoring/impact.ts). Same map, single
 *  source — kept under this name so the rollup queries' `IMPACT_WEIGHT[impact] ?? n` reads are untouched. */
export const IMPACT_WEIGHT: Record<string, number> = IMPACT_RANK;

/**
 * Canonicalize an org slug for a lookup: trim + lower-case. Org rows are PERSISTED lower-cased (the
 * GitHub-App install flow writes `opts.login.toLowerCase()`) and the auth layer (canReadOrg / getOrgId)
 * normalizes before authorizing, so every data-layer `findUnique({ where: { slug } })` must normalize
 * too — otherwise an authorized mixed-case login (e.g. `/org/PostHog`) misses the canonical `posthog`
 * row and the aggregate silently returns an empty "no data" dashboard. The single source for this
 * normalization across the whole org-rollup family, so the unnormalized-slug class can't recur.
 */
export function normalizeOrgSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

/**
 * Repo-level where-fragment that scopes an aggregate to a custom segment (a user-defined tag on
 * repos — see src/lib/db/segments.ts). Empty when no segment is selected, so every aggregate stays
 * fleet-wide by default. AND-combines with the existing `orgId` filter, so a segment id from another
 * org matches no repos rather than leaking across tenants.
 */
export function segmentScope(segmentId?: string | null) {
  return segmentId ? { segments: { some: { segmentId } } } : {};
}

/**
 * Repo-level where-fragment that scopes an aggregate to an auto-derived tech-stack group (Feature 3b —
 * frontend / backend:<lang> / mobile / …). Empty when no group is selected (fleet-wide default).
 * AND-combines with `orgId` and composes with segmentScope (segment AND stack). Keyed on the group's
 * globally-unique id (the page resolves the `?stack=` key → id against the org's own groups), so a group
 * id from another org matches no repos rather than leaking across tenants — exactly like segmentScope.
 */
export function techGroupScope(groupId?: string | null) {
  return groupId ? { techGroups: { some: { groupId } } } : {};
}

// All derived from the stored RepoContributor snapshots (latest scan per repo) — no extra
// GitHub calls. "commits"/"aiCommits" reflect the recent-activity window we capture at scan
// time. Bots ([bot]) and unattributed ("unknown") commits are excluded from the human view.
export const isBot = (login: string) => /\[bot\]$/i.test(login) || login === "unknown";

/** Arithmetic mean of a number list; **null** for an empty list — never 0, never NaN. */
export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/**
 * {@link mean}, rounded to the nearest integer. The canonical rounded-average for the org rollups.
 *
 * **Returns null for an empty list, and that is the whole point.** This function used to return `0`
 * and its docstring called that "always empty-guarded, so copies that omitted the guard are corrected
 * by routing through here" — which inverted the fix: consolidating scattered means into one helper
 * standardised the WRONG answer at 15 call sites. The mean of nothing is not zero; it does not exist.
 *
 * A returned `0` is indistinguishable from a measured 0, and downstream that is not a cosmetic
 * difference: `scoreHex(0)` is alarm red (the worst possible fleet grade), `postureFor(0, 0)` yields a
 * real posture classification for a segment nobody scanned, and a sort on the value ranks the
 * unmeasured below every measurement instead of outside them. The /org UX redesign found this same
 * defect in eight surfaces across seven tabs (2026-09-08); every one traced here or to a hand-rolled
 * copy of the old behaviour.
 *
 * The honest sibling already existed and had for months: `roundedMean(sum, count)` in
 * `src/components/launch/fleetMapDerive.ts` returns `number | null`, documented "null when nothing is
 * scored (never NaN/0)". Two functions, one name, opposite contracts — this one is now the other one.
 *
 * Callers render null through the shared viz vocabulary (`@/components/org/viz` — `missing` for "no
 * population to measure", `not-judged` for "never assessed"), whose `rendersValue()` is false, so a
 * void cannot print a numeral.
 */
export function roundedMean(xs: number[]): number | null {
  const m = mean(xs);
  return m === null ? null : Math.round(m);
}

/** The three headline fleet averages, as every scope-level summary in `src/lib/db` carries them
 *  ({@link OrgRollup}, `OrgHeaderSummary`, `SegmentSummary`). */
export interface FleetAverages {
  avgOverall: number | null;
  avgAdoption: number | null;
  avgRigor: number | null;
}

/** {@link FleetAverages} once {@link hasFleetGrade} has proven all three exist. */
export type Graded<T> = T & { avgOverall: number; avgAdoption: number; avgRigor: number };

/**
 * Does this scope have a fleet grade at all — i.e. did anything in it get live-scored?
 *
 * A type predicate rather than three coalesces, because the three averages **share one population**
 * (`realScoredCount`): they are null together or present together, and a consumer that has checked
 * one has checked all three. Checking them one at a time invites exactly the half-guarded call site
 * this whole change exists to remove — `avgOverall` tested, `avgAdoption` quietly `?? 0`-ed two lines
 * below it.
 *
 * Use it as the drop/render-absence gate: `if (!hasFleetGrade(rollup)) return null` reads as "this
 * scope has no grade to report", which is the honest sentence, and narrows the three fields for
 * everything after it. Note it is STRICTLY stronger than the `scannedCount === 0` guards it replaces:
 * a fleet of nothing but mock placeholders is scanned but not graded, and that is precisely the case
 * those guards let through to `levelForScore(0)` and an alarm-red badge.
 */
export function hasFleetGrade<T extends FleetAverages>(scope: T): scope is Graded<T> {
  // Loose `!= null` on purpose: it also catches an `undefined` the TYPE says cannot happen but a
  // hand-built row (a test fixture, a JSON round-trip that dropped the key) can still deliver. This
  // is a gate against printing a grade nobody measured; erring toward "no grade" is the safe side.
  return scope.avgOverall != null && scope.avgAdoption != null && scope.avgRigor != null;
}

/**
 * Streaming grouped-mean accumulator: feed `(key, value)` pairs, read back each key's ROUNDED mean.
 * Single-sources the `{ sum, n }`-per-key → `Math.round(sum / n)` idiom the rollups hand-rolled for
 * per-dimension / per-day / per-team averages (where {@link roundedMean} only covers the materialized-
 * array case). Backed by a Map, so `keys()`/`entries()` come back in first-seen insertion order —
 * callers that need a stable order sort explicitly, exactly as the inlined versions did.
 */
export class GroupedMean {
  private readonly acc = new Map<string, { sum: number; n: number }>();

  /** Add one sample to a key's running total. */
  add(key: string, value: number): void {
    const e = this.acc.get(key);
    if (e) {
      e.sum += value;
      e.n += 1;
    } else {
      this.acc.set(key, { sum: value, n: 1 });
    }
  }

  /** Rounded mean for a key (`Math.round(sum / n)`); 0 when the key was never added.
   *
   *  The 0 here is NOT the mean-of-nothing {@link roundedMean} was fixed for: it is a LOOKUP miss, and
   *  every key a caller can hold came out of `keys()`/`entries()` — i.e. was added, so it has a real
   *  population. There is no "empty key" to answer for; asking for an absent one is out of domain. */
  get(key: string): number {
    const e = this.acc.get(key);
    return e ? Math.round(e.sum / e.n) : 0;
  }

  /** Keys in first-seen insertion order. */
  keys(): string[] {
    return [...this.acc.keys()];
  }

  /** `[key, roundedMean]` pairs in first-seen insertion order. */
  entries(): [string, number][] {
    return [...this.acc.entries()].map(([k, e]) => [k, Math.round(e.sum / e.n)] as [string, number]);
  }
}

/**
 * The upper half of a window, as the two bounds an `OrgWindow` can carry. `endExclusive` is the
 * canonical one (`src/lib/org/timezone.ts` policy note 4: every interval is half-open
 * `[start, endExclusive)`); `end` survives only as the last representable instant of the SAME
 * interval, for the query builders that still say `lte`.
 */
export interface WindowUpperBounds {
  /** Inclusive last instant of the period. Legacy — equivalent to `endExclusive` only at ms resolution. */
  end?: Date | null;
  /** Canonical HALF-OPEN upper bound. Wins over `end` whenever it is present. */
  endExclusive?: Date | null;
}

/**
 * The window's upper bound as a Prisma date-filter fragment, or null when the window is open-ended.
 *
 * Prefers `lt: endExclusive` over `lte: end`. The two agree at millisecond resolution (`end` is
 * `endExclusive − 1ms`), but Postgres `timestamp` keeps MICROseconds, so a scan landing in the
 * 999 µs after `end` — i.e. inside the last millisecond of the excluded boundary instant — matched
 * `lte: end` and would also match the NEXT window's `gte: start`. Half-open is the only form that
 * partitions cleanly, which is what the adjacent-window comparisons (briefing's prior period) depend
 * on. Accepts a bare `Date` for the handful of call sites that only have an inclusive end.
 */
export function upperBound(bounds?: WindowUpperBounds | Date | null): { lt: Date } | { lte: Date } | null {
  if (!bounds) return null;
  if (bounds instanceof Date) return { lte: bounds };
  if (bounds.endExclusive) return { lt: bounds.endExclusive };
  if (bounds.end) return { lte: bounds.end };
  return null;
}

/**
 * Optional date-range where-fragment for a Prisma date column. Returns `{}` when neither bound is
 * given (the query stays unbounded), else `{ [field]: { gte?, lt?/lte? } }` carrying only the bounds
 * that are present. Single-sources the windowed spread the rollup queries hand-rolled per call site;
 * `field` selects the column (`scannedAt` by default, `createdAt` for the recommendation-event
 * query). Spread the result into a `where` object.
 *
 * `start` is passed separately from `bounds` because several callers clamp the lower edge to the
 * plan's retention cutoff while the upper edge still comes from the caller's window. Pass the whole
 * `OrgWindow` as `bounds` so the half-open `endExclusive` is honored (see {@link upperBound}).
 */
export function dateRange<F extends string = "scannedAt">(
  start?: Date | null,
  bounds?: WindowUpperBounds | Date | null,
  field: F = "scannedAt" as F,
): { [K in F]?: { gte?: Date; lte?: Date; lt?: Date } } {
  const out: { [K in F]?: { gte?: Date; lte?: Date; lt?: Date } } = {};
  const upper = upperBound(bounds);
  if (!start && !upper) return out;
  out[field] = { ...(start ? { gte: start } : {}), ...(upper ?? {}) };
  return out;
}

/** Share (0..100) of a person's commits that are AI-attributed; 0 when they have no commits.
 *  Single source for the "AI champion" share formula used by both contributor and team rollups. */
export function aiShareOf(commits: number, aiCommits: number): number {
  return commits ? Math.round((aiCommits / commits) * 100) : 0;
}

/**
 * Select the top-N "champions" from a human-only contributor list: keep those passing `filter`, sort by
 * the `by` metric descending, and take the first `limit`. The shared select-shape behind both
 * `getContributorInsights` (ranked by championScore, sliced 6, requires ≥3 commits) and `rollupTeams`
 * (ranked by aiCommits, sliced 3); each caller supplies its own filter/metric/limit. Does not mutate
 * the input (sorts a copy).
 */
export function pickChampions<T>(people: T[], opts: { filter: (p: T) => boolean; by: (p: T) => number; limit: number }): T[] {
  return people
    .filter(opts.filter)
    .sort((a, b) => opts.by(b) - opts.by(a))
    .slice(0, opts.limit);
}
