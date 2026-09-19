// The recall LOSERS, grouped by reason and given the epistemic state that says whether a bigger
// budget would admit them.
//
// This module is the (E) Encoded destination of the recall panel's longest sentence — "Everything
// that did not make it is listed below with the reason" — plus the distinction that sentence buried:
// a budget-bound omission is FIXABLE (raise the budget and it lands), while a superseded, archived or
// expired one is not, at any budget. Prose stated that distinction once, above the panel, and then
// rendered both groups identically. Here it is the paint:
//
//   over budget → `measured`    scored, ranked, admissible — it only lost on size.
//   superseded  → `superseded`  replaced by a correction; kept, not deleted.
//   archived    → `superseded`  soft-retired; the row is still in the store.
//   expired     → `superseded`  past its TTL; the row is still in the store.
//   filtered    → `not-judged`  excluded by the caller's own kind/namespace filter BEFORE scoring,
//                               so there is no score to show and a hatch must print no value.
//
// Pure: no React, no fetch. `Omission` comes from the kit so the shape cannot drift from BudgetPack.

import type { Omission, VizState } from "@/components/org/viz";
import type { IneligibleReason, RecallResponse } from "@/features/shared/memory/memoryRecall";
import { INELIGIBLE_COPY } from "@/features/shared/memory/memoryRecall";

/** The state each ineligibility reason paints in. See the header for why each one. */
export const INELIGIBLE_STATE: Record<IneligibleReason, VizState> = {
  superseded: "superseded",
  archived: "superseded",
  expired: "superseded",
  filtered: "not-judged",
};

/** The state a budget-bound omission paints in: it WAS scored, so it is a measurement. */
export const BUDGET_STATE: VizState = "measured";

/** The (D) sentence the two groups used to need a paragraph to separate. One line, on demand. */
export const OMISSION_HINT =
  "Solid blocks were scored and lost on size alone — raising the budget admits them. " +
  "Struck and hatched blocks are not recallable at any budget.";

/** The (D) sentence for the packed bar: this panel is a real recall, not a preview. */
export const PACKED_HINT =
  "A real recall, not a preview: what was packed had its delivery count incremented, " +
  "because it reached a reader. That records delivery, never evidence that it helped.";

/** The (D) sentence for the budget group. Whole-item, greedy — an oversized memory is skipped. */
export const BUDGET_GROUP_HINT =
  "Scored and recallable; they only failed to fit. Packing is whole-item and greedy, so an " +
  "oversized memory is skipped rather than ending the pass. Raise the budget to admit them.";

/** The (D) sentence for the ineligible group. No budget admits these. */
export const INELIGIBLE_GROUP_HINT =
  "Present in the store but never recallable, whatever the budget. They are kept, not deleted, " +
  "so the correction that retired them stays auditable.";

/**
 * One block per reason, sized by count, in the order a reader should read them: the fixable group
 * first, then the ones no budget moves. Zero-count groups are dropped — BudgetPack would render a
 * 3-unit floor block for them, which is a mark asserting a group that is not there.
 */
export function recallOmissions(r: RecallResponse): Omission[] {
  const out: Omission[] = [];
  if (r.omitted.length > 0) {
    out.push({
      id: "budget",
      label: "over budget",
      count: r.omitted.length,
      state: BUDGET_STATE,
    });
  }
  // Group the ineligible rows by their own reason so "replaced by a correction" and "past its TTL"
  // stay two facts, exactly as INELIGIBLE_COPY already keeps them two facts per row.
  const byReason = new Map<IneligibleReason, number>();
  for (const row of r.ineligible) {
    byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + 1);
  }
  for (const reason of ["superseded", "archived", "expired", "filtered"] as const) {
    const count = byReason.get(reason) ?? 0;
    if (count > 0) {
      out.push({
        id: reason,
        label: INELIGIBLE_COPY[reason],
        count,
        state: INELIGIBLE_STATE[reason],
      });
    }
  }
  return out;
}

/** The states actually present, in reading order — a legend never teaches an encoding not on screen. */
export function omissionStates(omissions: Omission[]): VizState[] {
  const seen: VizState[] = ["measured"];
  for (const o of omissions) {
    if (!seen.includes(o.state)) seen.push(o.state);
  }
  return seen;
}
