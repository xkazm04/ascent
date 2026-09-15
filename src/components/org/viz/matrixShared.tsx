// What every MatrixGrid renderer shares: the row/cell contract, the void padding rule, and the
// accessible equivalents (the aria sentence and the sr-only table).
//
// Hoisted out of MatrixGrid.tsx for the /prototype round so the baseline and its directional
// variants paint AND announce from one source — a variant cannot drift from the contract it is
// being judged against. Server-safe: no hooks, no client boundary.

import { fmtNum, isNum } from "@/components/org/viz/vizNum";
import { STATE_LABEL, rendersValue, type VizState } from "@/components/org/viz/states";

export type MatrixCell = {
  state: VizState;
  /** 0..100. Printed only where the state permits a value — never on a hatch or a void. */
  score?: number | null;
};

export type MatrixRow = {
  id: string;
  label: string;
  /** One cell per axis, in axis order. A short row is padded with `missing` (void) cells. */
  cells: MatrixCell[];
};

export type MatrixGridProps = {
  /** Column names, e.g. ["Declared", "Observed", "Enforced"]. */
  axes: string[];
  rows: MatrixRow[];
  title?: string;
  className?: string;
};

export const VOID_CELL: MatrixCell = { state: "missing" };

/** The cell at axis `i`, or a void where the row is short — never a shifted-left neighbour. */
export function cellAt(row: MatrixRow, i: number): MatrixCell {
  return row.cells[i] ?? VOID_CELL;
}

/** The caveat every matrix ends on — the demoted A2 prose, delivered once to AT and never to sight. */
export const MATRIX_CAVEAT = "A hatched cell was not judged; an empty cell has no measurement and is not a zero.";

/** The one accessible sentence: every subject, every axis, every state, built from the painted cells. */
export function matrixAriaLabel(title: string, axes: string[], rows: MatrixRow[]): string {
  return (
    `${title}: ${rows.length} ${rows.length === 1 ? "subject" : "subjects"} across ${axes.join(", ")}. ` +
    rows
      .map(
        (r) =>
          `${r.label} — ` +
          axes
            .map((a, i) => {
              const c = cellAt(r, i);
              return `${a}: ${STATE_LABEL[c.state].toLowerCase()}${rendersValue(c.state) && isNum(c.score) ? ` ${c.score}` : ""}`;
            })
            .join(", "),
      )
      .join("; ") +
    ` ${MATRIX_CAVEAT}`
  );
}

/** The labelled placeholder for a matrix with no axes or no rows. */
export function MatrixEmpty({ title, className = "" }: { title: string; className?: string }) {
  return (
    <div role="img" aria-label={`${title}: no matrix data`} className={`type-body-sm text-slate-500 ${className}`}>
      No matrix data
    </div>
  );
}

/** The screen-reader table: a column per axis, a row per subject, a state (and value) per cell. */
export function MatrixSrTable({ title, axes, rows }: { title: string; axes: string[]; rows: MatrixRow[] }) {
  return (
    <table className="sr-only">
      <caption>{`${title} — state by subject and axis`}</caption>
      <thead>
        <tr>
          <th scope="col">Subject</th>
          {axes.map((a) => (
            <th key={a} scope="col">
              {a}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <th scope="row">{row.label}</th>
            {axes.map((a, i) => {
              const c = cellAt(row, i);
              return (
                <td key={a}>
                  {rendersValue(c.state) && isNum(c.score) ? `${STATE_LABEL[c.state]} — ${fmtNum(c.score, 0)}` : STATE_LABEL[c.state]}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
