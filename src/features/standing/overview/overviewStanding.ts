// Pure derivation for the Overview's headline standing strip (OrgScoreBadges). Kept out of the .tsx
// so the no-jsdom vitest setup can pin it — the same split repoCategoryRollupLogic.tsx uses, and the
// split PeriodSummary.test.ts wishes its component had had.
//
// EVERY input comes off the rollup the Overview's fleet panel already awaits (getOrgRollup). This
// module must never introduce a field that needs a second query: the standing strip is the first
// thing the tab paints after the chrome, and a query bolted on here would be a query bolted onto the
// dashboard's landing path.
//
// DELIBERATELY NO `goal`: ScoreBadge carries an optional goal-pacing qualifier, but the goals it
// would need come from `listGoals` — a read the Overview does not (and should not) make. An absent
// optional prop renders nothing; the Plan tab owns goal pacing.

import { levelForScore } from "@/lib/maturity/model";
import { scoreHex } from "@/lib/ui";
import type { TrendPoint } from "@/components/report/TrendChart";
import type { ScoreBadge } from "./OrgScoreBadges";
import type { OrgRollup } from "@/lib/db";

/** The slice of OrgRollup the standing strip reads — named so a rollup field going away is a type
 *  error here rather than a silently blank badge. */
export type StandingSource = Pick<
  OrgRollup,
  | "avgOverall"
  | "avgAdoption"
  | "avgRigor"
  | "scannedCount"
  | "repoCount"
  | "deltas"
  | "realScoredCount"
  | "mockCount"
>;

/** What a score badge shows when the set it averages over is EMPTY of live-scored repos. Never a 0:
 *  a 0 in `scoreHex(0)` alarm-red reads as a catastrophic fleet grade rather than "nothing here was
 *  measured". Same rendering the cohort card lands on.
 *
 *  This used to be reached by re-deriving "was anything measured?" from `realScoredCount === 0` — a
 *  DIFFERENT field than the one being drawn — because `roundedMean([])` returned a 0 the badge could
 *  not tell apart from a grade. It returns null now, so each badge branches on its own value and the
 *  re-derivation is gone. `realScoredCount` still writes the basis LINE (a denominator is a count). */
const NO_SCORE = "—";

/**
 * The basis line for the three averages — the denominator they were measured over and the count they
 * excluded. Worded to MATCH the cohort card's tooltip (RepoCategoryRollup) verbatim, because the two
 * numbers now come from the same predicate and a reader comparing them should not have to decide
 * whether two different sentences describe the same rule.
 */
function basisTitle(r: StandingSource): string {
  if (r.realScoredCount === 0)
    return `No live-scored repositories in this set${r.mockCount > 0 ? ` (all ${r.mockCount} carry a deterministic mock score)` : ""}`;
  return `Average over the ${r.realScoredCount} live-scored repo${r.realScoredCount === 1 ? "" : "s"}${
    r.mockCount > 0 ? ` · ${r.mockCount} mock placeholder${r.mockCount === 1 ? "" : "s"} excluded` : ""
  }`;
}

/**
 * The four headline numbers, in the order a leader reads them: where the fleet stands (with its
 * maturity level spelled out), the two halves that produce it, and the coverage those averages are
 * computed over — a 62 across 3 of 40 repos is a different claim than a 62 across 40 of 40.
 *
 * `delta` is the rollup's COHORT-MATCHED period movement (repos present on both sides of the
 * window), not current-minus-fleet-average — so a mid-period onboarding wave never reads as
 * improvement. `undefined`/`0` hides the arrow, which is why the coverage badge carries none.
 *
 * `comparisonLabel` is the window's canonical delta basis ("vs 30d ago", "vs quarter start" — the
 * `ResolvedWindow` field that exists for exactly this) and rides out with the arrow. A period delta
 * with no stated endpoints is unreadable, and this Overview prints two other cells both called "this
 * period" that measure different things; the badge arrow was the one carrying no label at all.
 * Empty for "All time", which also has no baseline, so no arrow renders there anyway.
 */
export function buildScoreBadges(r: StandingSource, comparisonLabel?: string): ScoreBadge[] {
  const title = basisTitle(r);
  const level = r.avgOverall === null ? null : levelForScore(r.avgOverall);
  // One chip, on the headline badge only — the same words the cohort card uses. Repeating it under
  // all three averages would be three copies of one fact.
  const note = r.mockCount > 0 ? `${r.mockCount} mock (excluded from avg)` : undefined;

  const score = (label: string, value: number | null, delta: number | undefined): ScoreBadge =>
    value !== null
      ? { label, value, color: scoreHex(value), delta, deltaLabel: comparisonLabel || undefined, title }
      : // No live-scored repo in this set: there is no average to state, and no movement to state
        // either — a delta over an empty cohort is not a measurement of anything.
        { label, value: NO_SCORE, title };

  return [
    { ...score("Org maturity", r.avgOverall, r.deltas?.overall), sub: level ? `${level.id} · ${level.name}` : undefined, note },
    score("AI Adoption", r.avgAdoption, r.deltas?.adoption),
    score("Engineering Rigor", r.avgRigor, r.deltas?.rigor),
    { label: "Repos scanned", value: `${r.scannedCount}/${r.repoCount}` },
  ];
}

/**
 * The org-maturity daily series as sparkline points. Org rollup points are per-day AVERAGES with no
 * single underlying scan, so they deliberately carry no `href`/`sha`/`engine` — TrendChart keeps such
 * points non-interactive rather than linking to a report that does not exist.
 */
export function buildTrendPoints(trend: OrgRollup["trend"]): TrendPoint[] {
  return trend.map((t) => ({ score: t.avg, at: t.date }));
}
