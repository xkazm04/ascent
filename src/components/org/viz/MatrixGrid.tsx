"use client";

// A declared × observed × enforced heat matrix.
//
// Practices, passports and settings all ask the same question of every subject: is this thing
// claimed, is it actually there, and is it enforced? Three columns, one cell each, and — the part a
// table of ticks cannot do — a cell that is HATCHED because nobody judged it, distinct from a cell
// that is EMPTY because there was no measurement, distinct from a cell that is OUTLINED because it
// was declared and never observed being enforced. A hatched cell prints no number, ever.

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { scoreHex } from "@/lib/ui";
import { fmtNum, isNum, r2 } from "@/components/org/viz/vizNum";
import { AXIS_SVG_CLASS, axisHeaderHeight, wrapAxisLabel } from "@/components/org/viz/matrixAxis";
import {
  KICKER_SVG_CLASS,
  STATE_LABEL,
  VizDefs,
  isStruck,
  isVoid,
  rendersValue,
  stateDash,
  stateFill,
  stateFillOpacity,
  stateStroke,
  stateStrokeWidth,
  stateTitle,
  type VizState,
} from "@/components/org/viz/states";

const LABEL_W = 104;
const CELL_W = 46;
const CELL_H = 26;
/** Line box for a wrapped axis header line; the band's total height comes from `axisHeaderHeight`. */
const AXIS_LINE_H = 10;

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

const VOID_CELL: MatrixCell = { state: "missing" };

export function MatrixGrid({
  axes,
  rows,
  title = "Matrix",
  className = "",
}: {
  /** Column names, e.g. ["Declared", "Observed", "Enforced"]. */
  axes: string[];
  rows: MatrixRow[];
  title?: string;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;

  if (axes.length === 0 || rows.length === 0) {
    return (
      <div role="img" aria-label={`${title}: no matrix data`} className={`type-body-sm text-slate-500 ${className}`}>
        No matrix data
      </div>
    );
  }

  // Axis headers wrap rather than overhang their column (see matrixAxis.ts), so the header band's
  // height is a function of the tallest label — not a constant.
  const axisLines = axes.map((a) => wrapAxisLabel(a));
  const headerH = axisHeaderHeight(axisLines, AXIS_LINE_H);
  const W = LABEL_W + axes.length * CELL_W;
  const H = headerH + rows.length * CELL_H;
  const cellAt = (row: MatrixRow, i: number): MatrixCell => row.cells[i] ?? VOID_CELL;

  const ariaLabel =
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
    ". A hatched cell was not judged; an empty cell has no measurement and is not a zero.";

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        <VizDefs />

        {axes.map((a, i) => {
          const lines = axisLines[i] ?? [a];
          // Bottom-aligned against the rule, so a one-line header sits where it always did and a
          // two-line one grows upward instead of shunting the grid.
          const firstY = headerH - 6 - (lines.length - 1) * AXIS_LINE_H;
          return (
            <text key={a} x={LABEL_W + i * CELL_W + CELL_W / 2} y={r2(firstY)} textAnchor="middle" fontSize={9} className={AXIS_SVG_CLASS}>
              {/* The full name always survives in the aria-label, the <title> and the sr-only table,
                  so an ellipsized header costs a sighted reader precision, never a reader using AT. */}
              <title>{a}</title>
              {lines.map((ln, li) => (
                <tspan key={ln + li} x={LABEL_W + i * CELL_W + CELL_W / 2} dy={li === 0 ? 0 : AXIS_LINE_H}>
                  {ln}
                </tspan>
              ))}
            </text>
          );
        })}

        {rows.map((row, ri) => {
          const y = headerH + ri * CELL_H;
          return (
            <g
              key={row.id}
              style={{
                opacity: animate ? 1 : 0,
                transition: reduced ? undefined : `opacity 0.4s ease-out ${Math.min(ri * 45, 360)}ms`,
              }}
            >
              <text x={0} y={y + CELL_H / 2 + 3} fontSize={10} className={KICKER_SVG_CLASS}>
                {row.label}
              </text>
              {axes.map((a, ci) => {
                const cell = cellAt(row, ci);
                const x = LABEL_W + ci * CELL_W;
                const base = isNum(cell.score) ? scoreHex(cell.score) : undefined;
                const cx = x + CELL_W / 2;
                const cy = y + CELL_H / 2;
                return (
                  <g key={`${row.id}-${a}`} data-cell={`${row.id}:${a}`} data-state={cell.state}>
                    {/* the cell frame — always drawn so a void is a locatable EMPTY cell, not a hole */}
                    <rect x={x + 2} y={y + 2} width={CELL_W - 4} height={CELL_H - 4} rx={3} fill="none" stroke="var(--color-divider)" strokeWidth={1} strokeOpacity={0.5} />
                    {!isVoid(cell.state) && (
                      <rect
                        data-mark
                        x={x + 2}
                        y={y + 2}
                        width={CELL_W - 4}
                        height={CELL_H - 4}
                        rx={3}
                        fill={stateFill(cell.state, base)}
                        fillOpacity={stateFillOpacity(cell.state) * 0.4}
                        stroke={stateStroke(cell.state, base)}
                        strokeWidth={stateStrokeWidth(cell.state)}
                        strokeDasharray={stateDash(cell.state)}
                      />
                    )}
                    {rendersValue(cell.state) && isNum(cell.score) && (
                      <text data-score x={cx} y={cy + 4} textAnchor="middle" fontSize={11} className="fill-slate-200 font-mono tabular-nums">
                        {fmtNum(cell.score, 0)}
                      </text>
                    )}
                    {isStruck(cell.state) && (
                      <line data-strike x1={x + 6} y1={cy} x2={x + CELL_W - 6} y2={cy} stroke="var(--color-divider)" strokeWidth={1.5} />
                    )}
                    <title>{stateTitle(cell.state, `${row.label} · ${a}`)}</title>
                  </g>
                );
              })}
            </g>
          );
        })}
        {/* header underrule — the one hairline, at 2dp so server and client serialise identically */}
        <line x1={0} y1={r2(headerH - 2)} x2={W} y2={r2(headerH - 2)} stroke="var(--color-divider)" strokeWidth={1} />
      </svg>

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
                    {rendersValue(c.state) && isNum(c.score)
                      ? `${STATE_LABEL[c.state]} — ${fmtNum(c.score, 0)}`
                      : STATE_LABEL[c.state]}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
