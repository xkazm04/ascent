"use client";

// A declared × observed × enforced heat matrix — set as a LEDGER.
//
// Practices, passports and settings all ask the same question of every subject: is this thing
// claimed, is it actually there, and is it enforced? One column per axis, one cell each, and — the
// part a table of ticks cannot do — a cell that is HATCHED because nobody judged it, distinct from a
// cell that is EMPTY because there was no measurement, distinct from a cell that is OUTLINED because
// it was declared and never observed being enforced. A hatched cell prints no number, ever.
//
// THE LEDGER (won the /prototype round 2026-09-15 over the shipped SVG renderer and a "Strata"
// band layout). Nothing here is drawn in viewBox units: the grid is CSS, so every glyph is set in the
// semantic `type-*` scale at the size it was designed at, whatever width the panel gives it. The SVG
// renderer's 9/10/11-unit text scaled with the container — tiny in a narrow column, huge in a wide
// one — and squeezed every subject into a 104-unit gutter, which is why its consumers pre-truncated
// labels to 13–18 characters. Here the subject column is a real text track (12–22rem) that WRAPS to
// two lines before it clips, and every track has a maximum, so the grid sizes itself: a consumer no
// longer needs a `max-w-*` cap to keep it from ballooning.
//
// The cell keeps the SVG encoding (matrixMark.tsx): the ONE hatch, the dash array, the accent ring.
// A hatched or void cell never prints a numeral — `rendersValue` gates the <span>, structurally.
//
// INSPECT MODE (2026-09-23). The matrix is an ARIA `grid`, not an `img`: one tab stop (a roving
// tabindex keyed by row identity, matrixCursorModel.ts), arrow keys walk the cells, Home/End jump to
// the row's edges and Ctrl+Home/Ctrl+End to the grid's corners. Focusing or tapping a cell PINS a
// visible readout under the grid (MatrixReadout.tsx) with the subject, axis, state and caveat that
// used to live only in a hover title; Escape clears it. The header row and the subject labels are
// aria-hidden because each cell's accessible name already carries both, and the sr-only table stays
// the one place a reader finds column and row headers.

import { useState, type KeyboardEvent } from "react";
import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { scoreHex } from "@/lib/ui";
import { fmtNum, isNum } from "@/components/org/viz/vizNum";
import { isStruck, rendersValue, stateTitle } from "@/components/org/viz/states";
import { MatrixHatchDefs, MatrixMark, cellInk } from "@/components/org/viz/matrixMark";
import { MatrixEmpty, MatrixSrTable, cellAt, matrixAriaLabel, type MatrixGridProps } from "@/components/org/viz/matrixShared";
import { cellName, moveCursor, readoutText, resolveCursor, type MatrixCursor } from "@/components/org/viz/matrixCursorModel";
import { MatrixReadout } from "@/components/org/viz/MatrixReadout";

export type { MatrixCell, MatrixRow } from "@/components/org/viz/matrixShared";

/** Fill tint under a printed value — a measurement reads as a colour field, the ink stays legible. */
const FILL_ALPHA = 0.55;

/** The subject track flexes between a comfortable minimum and a reading maximum; each axis track
 *  holds a three-digit mono figure with air around it. One template for the head and every row. */
const template = (axes: number) => `minmax(12rem, 22rem) repeat(${axes}, minmax(3.5rem, 5.5rem))`;

/** The remembered position, with the row order it was taken against so a row change can carry it. */
type Roving = { cursor: MatrixCursor | null; ids: string[]; pinned: boolean };

/** Focus the cell element for `to` inside `grid`: attribute compare, so no id needs CSS escaping. */
function focusCell(grid: HTMLElement, to: MatrixCursor) {
  const key = `${to.rowId}:${to.axis}`;
  for (const el of grid.querySelectorAll<HTMLElement>("[data-cell]")) {
    if (el.getAttribute("data-cell") === key) return el.focus();
  }
}

export function MatrixGrid({ axes, rows, title = "Matrix", className = "" }: MatrixGridProps) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;
  const [roving, setRoving] = useState<Roving>({ cursor: null, ids: [], pinned: false });

  if (axes.length === 0 || rows.length === 0) return <MatrixEmpty title={title} className={className} />;

  const columns = template(axes.length);
  const rowIds = rows.map((r) => r.id);
  // Derived, never synced: the live cursor is the remembered one carried across any row change.
  const cursor = resolveCursor(roving.cursor, roving.ids, rowIds, axes)!;
  const pinRow = roving.pinned ? rows.find((r) => r.id === cursor.rowId) : undefined;
  const readout = pinRow ? readoutText(pinRow.label, cursor.axis, cellAt(pinRow, axes.indexOf(cursor.axis))) : null;

  const pin = (to: MatrixCursor) => setRoving({ cursor: to, ids: rowIds, pinned: true });
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      if (!roving.pinned) return; // not ours: an enclosing dialog may want it
      e.preventDefault();
      e.stopPropagation();
      return setRoving({ cursor, ids: rowIds, pinned: false });
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      return pin(cursor);
    }
    const to = moveCursor(cursor, e.key, rowIds, axes, { ctrl: e.ctrlKey || e.metaKey });
    if (!to) return;
    e.preventDefault();
    pin(to);
    focusCell(e.currentTarget, to);
  };

  return (
    <div className={className}>
      {/* One accessible name for the grid, built from the cells it paints. The sr-only table sits
          OUTSIDE this element: it is the headers' home, so the grid adds no second set. */}
      <div role="grid" aria-label={matrixAriaLabel(title, axes, rows)} onKeyDown={onKeyDown} className="relative">
        <MatrixHatchDefs />
        <div aria-hidden="true" className="grid" style={{ gridTemplateColumns: columns }}>
          <div className="type-micro self-end border-b border-divider pb-1.5 font-mono uppercase tracking-[0.18em] text-slate-600">
            subject
          </div>
          {axes.map((a) => (
            <div
              key={a}
              title={a}
              className="type-label self-end border-b border-divider px-1 pb-1.5 text-center leading-tight tracking-[0.08em] text-slate-400 [overflow-wrap:anywhere]"
            >
              {a}
            </div>
          ))}
        </div>

        {rows.map((row, ri) => (
          <div
            key={row.id}
            role="row"
            data-row={row.id}
            className="grid border-b border-divider/50 last:border-b-0"
            style={{
              gridTemplateColumns: columns,
              opacity: animate ? 1 : 0,
              transition: reduced ? undefined : `opacity 0.4s ease-out ${Math.min(ri * 45, 360)}ms`,
            }}
          >
            <div
              aria-hidden="true"
              title={row.label}
              className="type-label line-clamp-2 min-w-0 self-center py-1.5 pr-3 leading-snug tracking-[0.06em] text-slate-300 [overflow-wrap:anywhere]"
            >
              {row.label}
            </div>
            {axes.map((a, ci) => {
              const cell = cellAt(row, ci);
              const base = isNum(cell.score) ? scoreHex(cell.score) : undefined;
              const printed = rendersValue(cell.state) && isNum(cell.score);
              const ink = cellInk(cell, FILL_ALPHA);
              const here = cursor.rowId === row.id && cursor.axis === a;
              return (
                <div
                  key={`${row.id}-${a}`}
                  role="gridcell"
                  aria-label={cellName(row.label, a, cell)}
                  tabIndex={here ? 0 : -1}
                  data-cell={`${row.id}:${a}`}
                  data-state={cell.state}
                  data-pinned={here && roving.pinned ? "" : undefined}
                  title={stateTitle(cell.state, `${row.label} · ${a}`)}
                  onFocus={() => pin({ rowId: row.id, axis: a })}
                  onClick={(e) => {
                    pin({ rowId: row.id, axis: a });
                    e.currentTarget.focus();
                  }}
                  className={`focus-ring relative h-10 cursor-pointer motion-safe:transition-shadow${here && roving.pinned ? " shadow-[inset_0_0_0_1px_var(--color-accent)]" : ""}`}
                >
                  <MatrixMark state={cell.state} base={base} alpha={FILL_ALPHA} />
                  {printed && (
                    <span
                      data-score
                      className={`absolute inset-0 grid place-items-center font-mono type-mono-sm font-medium tabular-nums${ink ? "" : " text-slate-200"}`}
                      style={ink ? { color: ink } : undefined}
                    >
                      {fmtNum(cell.score, 0)}
                    </span>
                  )}
                  {isStruck(cell.state) && <span data-strike className="absolute inset-x-4 top-1/2 h-px bg-divider" />}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <MatrixReadout text={readout} />
      <MatrixSrTable title={title} axes={axes} rows={rows} />
    </div>
  );
}
