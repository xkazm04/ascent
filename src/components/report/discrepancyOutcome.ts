// WHAT EACH FLAGGED CLAIM ACTUALLY DID — UAT `SAM-L1-06` (recurrence 2).
//
// "Flagged for review" listed `{dimension} {claim}` and a static lede, and never said what the
// disagreement CHANGED. The engine has always known: `scoreIntegrity.widenedDims`, `widenCapped`, and
// D9's structural exclusion from the widening loop. The header integrity chip discloses the outcome
// GLOBALLY ("widened D3", "audit capped"), which left a reader joining two panels by hand — and, worse,
// looking at a row the header says was acted on while the row itself says nothing.
//
// One word per row closes it. DERIVED, never stored: the record already exists and a second copy could
// disagree with the first, which is the exact failure this panel is trying to stop being.

import type { Discrepancy, ScoreIntegrity } from "@/lib/types";

export type DiscrepancyOutcome = {
  /** The one-word verdict rendered beside the row. */
  label: string;
  /** Why that verdict — the hover/sr-only explanation. */
  hint: string;
  /** True when the claim moved the score; drives the emphasis. */
  acted: boolean;
};

const WIDENED: DiscrepancyOutcome = {
  label: "widened",
  hint: "The model's objection was accepted: this dimension's guardband was doubled, so its score could move twice as far from the deterministic signal",
  acted: true,
};
const CAPPED: DiscrepancyOutcome = {
  label: "lost to the budget",
  hint: "The model flagged more dimensions than one scan's discrepancy budget allows, so NOTHING was widened — this run is pinned to what the detectors measured",
  acted: false,
};
const D9_DROPPED: DiscrepancyOutcome = {
  label: "D9 dropped as unmeasurable",
  hint: "Accepted as a visibility blind spot: D9's deterministic signal was excluded and the overall renormalized over the dimensions that could be measured, rather than counting an invisible control as a security absence",
  acted: true,
};
const INELIGIBLE: DiscrepancyOutcome = {
  label: "structurally ineligible",
  hint: "Recorded, but it could not move this score: the dimension is deterministic, was not measured, or never reached the blend. Worth verifying by hand — and useful for improving the detectors",
  acted: false,
};
const UNRECORDED: DiscrepancyOutcome = {
  label: "outcome not recorded",
  hint: "This report was written before the scan recorded which claims moved the score, so what this one did is unknown",
  acted: false,
};

/**
 * What one flagged claim DID to the score. Order matters and mirrors the engine's own order of
 * operations (scoring/engine.ts): the budget cap suppresses BOTH prose levers, so it outranks
 * everything; then an actually-widened dimension; then D9's separate visibility hatch; then
 * "recorded, changed nothing".
 *
 * A report with no `scoreIntegrity` (a snapshot from before the field existed) says so rather than
 * guessing — an absent record is not evidence that the claim was ignored.
 */
export function discrepancyOutcome(d: Discrepancy, integrity?: ScoreIntegrity): DiscrepancyOutcome {
  if (!integrity) return UNRECORDED;
  if (integrity.widenCapped) return CAPPED;
  if (integrity.widenedDims.includes(d.dimension)) return WIDENED;
  if (d.dimension === "D9" && integrity.d9Unmeasurable) return D9_DROPPED;
  return INELIGIBLE;
}
