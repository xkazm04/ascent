// The D9 check battery, expressed in the shared epistemic vocabulary (@/components/org/viz states).
//
// THE POINT OF THIS FILE. On a security surface the dangerous rendering is not a wrong number, it is
// an absence that looks like a pass. The old grid painted every un-scored control as a slate "n/a"
// chip: same pill, same border, one quieter colour — and on a dark canvas a quiet chip in a row of
// green ones reads as "nothing to see". This maps each control onto a `VizState` instead, so the
// question is settled by the geometry: a control that did not produce a grade is HATCHED and
// `rendersValue()` refuses it a numeral, and a repo with no battery at all is a VOID cell. Neither
// can acquire a passing number, no matter what a later caller does with it.
//
// Pure: no JSX, no hooks — the mapping is unit-testable on its own.

import type { MatrixCell, MatrixRow, VizState } from "@/components/org/viz";
import type { SecurityRowCheck } from "@/lib/org/security";
import { CHECK_ORDER, checksById } from "./securityRegisterShared";

/** Column headings for the matrix, in battery order (nine posture controls, then exposure). */
export const CHECK_AXES: string[] = CHECK_ORDER.map((c) => c.short);

/** The minimum a caller must supply per repo. Both the org register and the personal lens fit it. */
export interface SecurityMatrixInput {
  fullName: string;
  name: string;
  checks: SecurityRowCheck[];
  /** False ⇒ the scan carried no D9 row; every cell is a void, never a zero. */
  measured: boolean;
}

/** Row labels are drawn at a fixed 104px gutter — truncate rather than let a long name run under the grid. */
const LABEL_MAX = 16;
export function shortLabel(name: string): string {
  return name.length <= LABEL_MAX ? name : `${name.slice(0, LABEL_MAX - 1)}…`;
}

/**
 * One control's state.
 *
 * `null` is the producer's ONE signal for "this control was excluded from the D9 denominator", and
 * `not-judged` is its exact counterpart in the shared vocabulary: not readable, not a finding, never
 * counted as passing. src/lib/security/checks.ts reaches that null down four different roads — the
 * control had no subject ("No GitHub Actions workflows to scope"), the sensor read threw, the scan was
 * a structurally-blind worktree, or there was no token to read branch protection — and it distinguishes
 * them ONLY in free-text evidence. We deliberately do not re-derive that split from prose here: a
 * substring matcher against sentences the producer is free to reword would go quietly wrong in the one
 * direction that matters. One producer behaviour (excluded from the denominator) → one state.
 */
export function checkState(check: SecurityRowCheck | undefined): VizState {
  if (!check) return "missing"; // the battery ran but never emitted this control
  return check.score === null ? "not-judged" : "measured";
}

/** Battery grades are 0–10; the matrix (and `scoreHex`) speak 0–100, the same scale as D9 itself. */
export function cellScore(check: SecurityRowCheck | undefined): number | null {
  return check && check.score !== null ? check.score * 10 : null;
}

export function matrixRows(rows: SecurityMatrixInput[]): MatrixRow[] {
  return rows.map((r) => {
    const byId = r.measured ? checksById(r.checks) : new Map<string, SecurityRowCheck>();
    const cells: MatrixCell[] = CHECK_ORDER.map((c) => {
      const check = byId.get(c.id);
      const state = checkState(check);
      return { state, score: cellScore(check) } satisfies MatrixCell;
    });
    return { id: r.fullName, label: shortLabel(r.name), cells };
  });
}

/** Only the states actually present, in vocabulary order — the Legend contract (never a static six). */
export function statesPresent(rows: MatrixRow[]): VizState[] {
  const seen = new Set<VizState>();
  for (const r of rows) for (const c of r.cells) seen.add(c.state);
  return (["measured", "not-judged", "missing"] as const).filter((s) => seen.has(s));
}

/** Per-repo tally for the register's Gaps column: the two counts a chip row could not show at once. */
export function checkTally(row: SecurityMatrixInput): { failing: number; notJudged: number; graded: number } {
  if (!row.measured) return { failing: 0, notJudged: 0, graded: 0 };
  let failing = 0;
  let notJudged = 0;
  let graded = 0;
  for (const c of row.checks) {
    if (c.score === null) notJudged += 1;
    else {
      graded += 1;
      if (c.group === "posture" && c.score < 4) failing += 1;
    }
  }
  return { failing, notJudged, graded };
}
