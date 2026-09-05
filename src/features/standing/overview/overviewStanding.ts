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
  "avgOverall" | "avgAdoption" | "avgRigor" | "scannedCount" | "repoCount" | "deltas"
>;

/**
 * The four headline numbers, in the order a leader reads them: where the fleet stands (with its
 * maturity level spelled out), the two halves that produce it, and the coverage those averages are
 * computed over — a 62 across 3 of 40 repos is a different claim than a 62 across 40 of 40.
 *
 * `delta` is the rollup's COHORT-MATCHED period movement (repos present on both sides of the
 * window), not current-minus-fleet-average — so a mid-period onboarding wave never reads as
 * improvement. `undefined`/`0` hides the arrow, which is why the coverage badge carries none.
 */
export function buildScoreBadges(r: StandingSource): ScoreBadge[] {
  const level = levelForScore(r.avgOverall);
  return [
    {
      label: "Org maturity",
      value: r.avgOverall,
      sub: `${level.id} · ${level.name}`,
      color: scoreHex(r.avgOverall),
      delta: r.deltas?.overall,
    },
    { label: "AI Adoption", value: r.avgAdoption, color: scoreHex(r.avgAdoption), delta: r.deltas?.adoption },
    { label: "Engineering Rigor", value: r.avgRigor, color: scoreHex(r.avgRigor), delta: r.deltas?.rigor },
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
