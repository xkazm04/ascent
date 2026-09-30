// A MatrixGrid cell, restated as a CellMark. The number stays a number. Hue does not.
//
// `measured` at 100 is met. Any lower measured share, including a real 0, is partial: the kit's
// `missing` mark strikes the word through, and a struck 0 would read as "no measurement". A
// declaration is partial even at 100, because a claim is not a pass. `not-judged` and `missing`
// print "not measured" and never a numeral.

import type { CellState } from "@/components/kit";
import type { MatrixCell } from "@/components/org/viz/matrixShared";
import { rendersValue } from "@/components/org/viz/states";
import { isNum } from "@/components/org/viz/vizNum";

export interface CellMarkView {
  state: CellState;
  word: string;
}

export function cellMarkView(cell: MatrixCell): CellMarkView {
  if (!rendersValue(cell.state) || !isNum(cell.score)) {
    return { state: "unmeasured", word: "not measured" };
  }
  const word = String(Math.round(cell.score));
  if (cell.state === "declared") return { state: "partial", word };
  if (cell.score >= 100) return { state: "met", word };
  return { state: "partial", word };
}
