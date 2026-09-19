// The basis clause — a measured expectation rendered WITH the evidence that licenses it, or nothing.
//
// This module is the G4 boundary of moonshot #9. Every other product on this shelf recommends
// practices; the claim this one can make is "closing this gap moved D2 by +11 across 37 measured
// closes under r10/claude". That claim is only worth more than a label if the number can never appear
// without its basis — so the median, the sample count and the instrument are FORMATTED IN ONE STRING
// by one function. There is no exported "just the median" formatter, deliberately: the same reasoning
// as `meanDeltaLine` in skill-outcomes.ts, where the counts live inside the object that holds the mean
// so a consumer cannot obtain the number without the coverage that qualifies it.
//
// And the absence rule: no measured peers yields `null`, never `"+0"`. A zero is a MEASUREMENT — it
// says the intervention was tried and moved nothing. Rendering "no evidence" as "+0" would publish a
// finding nobody made.
//
// Pure: no Prisma, no React, no `@/lib/db`. Client-importable.

import { OUTCOME_MIN_SAMPLES, type LiftDistribution } from "@/lib/outcomes/aggregate";

/** Signed, so a negative measured lift reads as one. Halves survive an even-length median. */
function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${r}` : `${r}`;
}

/**
 * The one-line basis clause for a roadmap item, or `null` when there is no publishable evidence.
 *
 * Returns null for null/undefined input (the aggregate omits a below-floor partition entirely) and,
 * defensively, for any distribution that arrives below {@link OUTCOME_MIN_SAMPLES} — the floor is
 * checked at both ends so a future caller that builds a distribution by hand cannot route around it.
 *
 * Shape: `D2 +11 median (IQR +6…+15) across 37 measured closes · r10 · claude`. The IQR is omitted
 * when the partition has no per-dimension deltas; the whole clause falls back to the overall-score
 * movement (`overall +4 median …`) when `dimId` is null (a whole-scan outcome) or no sample carried a
 * dimension delta. It never invents a dimension for a whole-scan measurement.
 */
export function expectedLiftClause(d: LiftDistribution | null | undefined): string | null {
  if (!d) return null;
  if (d.n < OUTCOME_MIN_SAMPLES) return null;
  const useDim = d.dimId !== null && d.medianDim !== null;
  const label = useDim ? d.dimId : "overall";
  const median = useDim ? d.medianDim! : d.medianOverall;
  const iqr = useDim && d.p25 !== null && d.p75 !== null ? ` (IQR ${signed(d.p25)}…${signed(d.p75)})` : "";
  const closes = `${d.n} measured close${d.n === 1 ? "" : "s"}`;
  return `${label} ${signed(median)} median${iqr} across ${closes} · ${d.instrument.rubricVersion} · ${d.instrument.engineProvider}`;
}

/**
 * The orderable strength of a measured distribution — the per-dimension median where there is one,
 * else the overall-score median. `null` (never 0) when there is no distribution, so a sort can fall
 * back to the model's own priority instead of burying an unmeasured item behind a fabricated zero.
 */
export function measuredRank(d: LiftDistribution | null | undefined): number | null {
  if (!d) return null;
  if (d.n < OUTCOME_MIN_SAMPLES) return null;
  return d.medianDim ?? d.medianOverall;
}
