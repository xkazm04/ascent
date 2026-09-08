// The fleet's SHAPE, as five numbers — the reading the leaderboard's sorted rows cannot give.
//
// A leaderboard answers "who is first?". The question a director actually opens this tab with is
// "what does my fleet look like?" — clustered, bimodal, one long tail — and a table sorted by score
// answers that only after the reader has scrolled every row and held the whole column in their head.
// `Distribution` from the /org viz kit draws it (docs/ORG-UX-REDESIGN.md §2.2); this module computes
// the summary it plots, so the picture and its generated sr-only table are provably the same numbers.
//
// Pure: no React, no DB, no fetch. The kit types are `import type`, so nothing client-side is pulled
// in by importing this from a server component.
//
// The quantile maths is deliberately a local copy of the R-7 method rather than an import from
// another feature group's stats module: `src/features/<group>/<tab>/` is the ownership boundary, and
// a cross-group import would make one tab's refactor another tab's regression.

import type { VizState } from "@/components/org/viz";

export type FiveNumber = { min: number; q1: number; median: number; q3: number; max: number };

/** What the fleet looks like on one measure, plus the repos that measure could not be taken on. */
export interface FleetShape {
  /** The five-number summary over SCORED repos, or null when fewer than two carry a score. */
  five: (FiveNumber & { n: number }) | null;
  /** Repos whose latest scan produced an overall score — the only denominator `five` uses. */
  scored: number;
  /** Repos in scope with no scan at all. NOT zeroes: they are `not-judged`, and carry no value. */
  unscored: number;
}

/**
 * Linear interpolation between order statistics (R-7, the spreadsheet PERCENTILE default), so a
 * four-repo fleet gets a median between the two middle values rather than an arbitrary pick.
 */
function quantileAt(sorted: readonly number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo] as number;
  if (lo === hi) return a;
  const b = sorted[hi] as number;
  return a + (b - a) * (idx - lo);
}

/**
 * The five-number summary of `values`, or null when the set cannot support one.
 *
 * Null — never a zero-width box — for fewer than two usable values: a "distribution" over a single
 * observation is a point drawn as a spread. Non-finite entries are DROPPED rather than coerced to 0
 * (§2.4: a missing measurement is never a zero), so `n` is what actually backed the box.
 */
export function quantiles(values: readonly number[]): (FiveNumber & { n: number }) | null {
  const clean = values.filter((v): v is number => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length < 2) return null;
  return {
    min: clean[0] as number,
    q1: quantileAt(clean, 0.25),
    median: quantileAt(clean, 0.5),
    q3: quantileAt(clean, 0.75),
    max: clean[clean.length - 1] as number,
    n: clean.length,
  };
}

/** The minimum a repo row needs for this module — structural, so an `OrgRepoRow` satisfies it. */
export interface ScoredRepo {
  latest: { overall: number } | null;
}

/**
 * The fleet's overall-score shape. An unscanned repo is counted separately and never enters the
 * box: it is `not-judged`, and a hatched swatch beside the plot says so in the shared vocabulary
 * rather than in a caption.
 */
export function fleetScoreShape(repos: readonly ScoredRepo[]): FleetShape {
  const scores = repos.map((r) => r.latest?.overall).filter((v): v is number => Number.isFinite(v));
  return { five: quantiles(scores), scored: scores.length, unscored: repos.length - scores.length };
}

/** Only the states this shape actually contains, in kit order — the `Legend` contract. */
export function fleetShapeStates(shape: FleetShape): VizState[] {
  const states: VizState[] = [];
  if (shape.scored > 0) states.push("measured");
  if (shape.unscored > 0) states.push("not-judged");
  return states;
}
