// The Impact Ledger's geometry — the merge funnel and the per-dimension movement, as pure data.
//
// The panel is a RECEIPT, and its whole credibility rests on refusals the old field-notes paragraph
// had to state in words: only re-scanned merges count, a merge without a rescan buys nothing, a
// verified merge with no baseline is not a zero, and per-repo overall deltas are never summed. Three
// of those are now shapes, and this module is where the shapes are decided — so the rules are
// testable without a DOM.
//
// THE INVARIANT. `ledger.dimPoints === null` means nothing has been re-scanned yet. The movement
// chart then has NO domain and draws a void: a dashed zero axis with no bars. A zeroed chart would
// draw a legible, symmetric "the period bought nothing", which is a measurement the ledger does not
// have. `hasMovement` is that decision, made once.

import type { FlowStage, VizState } from "@/components/org/viz";
import type { ImpactLedger } from "@/lib/db/org-impact";

/** (D) What "points" are and what they exclude — the old field note's first two sentences. */
export const IMPACT_BASIS_HINT =
  "Points are the measured delta on each PR's targeted dimension: the first scan after the merge against the repo's scan when the PR opened. Only re-scanned merges count.";

/** (D) Why a merged PR can buy nothing. */
export const IMPACT_AWAITING_HINT =
  "Merged, but the post-merge rescan has not landed. It contributes nothing to the points bought until it does — listed, never counted, never dropped.";

/** (D) Why a verified merge can still be unmeasurable. */
export const IMPACT_NO_BASELINE_HINT =
  "Re-scanned, but the repository had no baseline scan when the PR opened, so there is nothing to compare against. Shown as an em dash rather than as zero.";

/** (D) The rule the table's fourth column obeys — demoted from the field notes to the column head. */
export const IMPACT_NO_SUM_HINT =
  "Per-repo overall movement is shown per row and never summed: one repository's overall delta added to another's has no referent.";

/** (D) Why the branch column sits beside the bought number rather than inside it. */
export const IMPACT_IN_REVIEW_HINT =
  "Real, independently re-scanned movement on lane branches that have not merged. Reported beside the bought number, never inside it — nobody owns work that is still in review.";

export type MovementRow = {
  dimId: string;
  points: number;
  prs: number;
  state: VizState;
};

/**
 * The merge funnel: what merged, what came back re-scanned, and how many repositories actually moved.
 * All three are counts, so a zero here is a real zero — "nothing was re-scanned" is a measurement.
 * The unmeasured quantity in this panel is the POINTS, and that void lives in the movement chart.
 */
export function impactFunnelStages(ledger: ImpactLedger): FlowStage[] {
  return [
    { id: "merged", label: "Merged", value: ledger.mergedCount, state: "measured" },
    { id: "verified", label: "Re-scanned", value: ledger.verifiedCount, state: "measured" },
    { id: "moved", label: "Repos moved", value: ledger.reposMoved, state: "measured" },
  ];
}

/** True when there is a verified total to plot at all. False ⇒ the movement chart draws a void. */
export function hasMovement(ledger: ImpactLedger): boolean {
  return ledger.dimPoints !== null && ledger.byDim.length > 0;
}

/** Biggest absolute movement first, so the row that dominates the period reads first. */
export function impactMovementRows(ledger: ImpactLedger): MovementRow[] {
  if (!hasMovement(ledger)) return [];
  return ledger.byDim
    .filter((d) => Number.isFinite(d.points))
    .map((d) => ({ dimId: d.dimId, points: d.points, prs: d.prs, state: "measured" as VizState }))
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

/** The symmetric domain for the diverging axis — gains and regressions share one scale, so a −4 and
 *  a +4 are the same length in opposite directions and cannot be read as different magnitudes. */
export function movementDomain(rows: MovementRow[]): number {
  return rows.reduce((m, r) => Math.max(m, Math.abs(r.points)), 0);
}
