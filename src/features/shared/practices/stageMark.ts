// Rollout stage → CellMark. Status is the glyph and the word. A score, when one exists, stays a
// separate paper figure. Unknown stays "not measured"; a known absence is "missing", never a zero.
import type { CellState } from "@/components/kit";

export interface StageMark {
  state: CellState;
  word: string;
  /** Paper figure beside the mark. Null when the cell has no number, including every unknown. */
  score: number | null;
}

export function stageMark(cell: { state?: string; score?: unknown } | undefined): StageMark {
  const score = typeof cell?.score === "number" ? cell.score : null;
  if (!cell || cell.state === "not-judged") return { state: "unmeasured", word: "not measured", score: null };
  if (cell.state === "missing") return { state: "missing", word: "missing", score: null };
  if (cell.state === "declared") return { state: "partial", word: "declared", score };
  if (cell.state === "measured") return { state: "met", word: score == null ? "landed" : "met", score };
  return { state: "unmeasured", word: "not measured", score: null };
}
