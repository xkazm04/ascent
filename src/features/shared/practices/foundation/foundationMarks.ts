// Foundation grid cells. A draft PR is partial (proposed, not observed). No Ascent PR is unmeasured:
// a hand-committed foundation is invisible here, so it is not "missing". Conformance null is
// unmeasured, never zero. A reported percent stays a paper figure beside the word "reported".
import type { CellState } from "@/components/kit";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";

export interface FoundationMark {
  state: CellState;
  word: string;
}

export function foundationPrMark(row: FoundationRolloutRow): FoundationMark {
  return row.foundationPrAt
    ? { state: "partial", word: "PR opened" }
    : { state: "unmeasured", word: "No Ascent PR" };
}

export function foundationBackMark(row: FoundationRolloutRow): FoundationMark {
  return row.reportBackAt
    ? { state: "met", word: "Provisioned" }
    : { state: "missing", word: "Not provisioned" };
}

export function foundationConformanceMark(row: FoundationRolloutRow): FoundationMark {
  return row.conformance == null
    ? { state: "unmeasured", word: "not measured" }
    : { state: "met", word: "reported" };
}
