// The doctor-check matrix as the /org viz kit sees it: repo × check-family, one `VizState` per cell.
//
// This module exists so the panel's headline reading is a SHAPE rather than the paragraph that used
// to sit above it. That paragraph promised: "A clause a run did not judge shows as 'not judged' —
// never as passing." A promise is only as good as the next edit. Here it is structural: a family the
// repo never judged returns `not-judged`, `rendersValue("not-judged")` is false, and MatrixGrid
// therefore CANNOT print a number in that cell. The invariant is enforced by the encoding.
//
// Pure: no React, no fetch. The type-only import of the kit's row shapes is erased at compile time,
// so this stays a server-safe `.ts` module that a test can call directly.

import type { MatrixCell, MatrixRow, VizState } from "@/components/org/viz";
import { parseCheckId } from "@/lib/standard/check-ids";
import type { ControlMatrixRowView } from "./controlMatrixView";

/** A clause with one of these levels was actually judged by the run. `unchecked` was not. */
const JUDGED = new Set(["pass", "warn", "fail"]);

export interface ControlVizModel {
  /** Column names — the check families, alphabetically, exactly as the table below groups them. */
  axes: string[];
  rows: MatrixRow[];
  /** Only the states this fleet's data actually contains, in kit order, for `Legend`. */
  states: VizState[];
}

const familyOf = (c: { check: string; family: string }): string => c.family || parseCheckId(c.check).family;

/**
 * One cell: the share of the family's JUDGED clauses this repo passed.
 *
 * `not-judged` covers both ways a cell can be evidence-free, which the old grid drew as two visually
 * identical dashes and the prose had to explain: the repo reported none of the family's clauses, or
 * reported them all as `unchecked` (a summary-only reporter reports nothing at all, so every one of
 * its cells lands here). Neither is a pass, and neither carries a number.
 */
function cellFor(row: ControlMatrixRowView, family: string): MatrixCell {
  const mine = row.checks.filter((c) => familyOf(c) === family);
  const judged = mine.filter((c) => JUDGED.has(c.level));
  if (judged.length === 0) return { state: "not-judged" };
  const passed = judged.filter((c) => c.level === "pass").length;
  return { state: "measured", score: Math.round((100 * passed) / judged.length) };
}

/** Build the fleet overview. Row order is the API's, so the grid and the table below cannot disagree. */
export function controlVizModel(rows: ControlMatrixRowView[]): ControlVizModel {
  const families = [...new Set(rows.flatMap((r) => r.checks.map(familyOf)))].sort((a, b) => a.localeCompare(b));
  const gridRows: MatrixRow[] = rows.map((r) => ({
    id: r.repoFullName,
    label: r.repoFullName,
    cells: families.map((f) => cellFor(r, f)),
  }));
  const present = new Set<VizState>(gridRows.flatMap((r) => r.cells.map((c) => c.state)));
  // Kit order, filtered to what is on screen — a legend teaching an encoding this fleet does not use
  // is the prose problem in another costume.
  const states = (["measured", "not-judged"] as VizState[]).filter((s) => present.has(s));
  return { axes: families, rows: gridRows, states };
}
