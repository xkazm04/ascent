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

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { scoreHex } from "@/lib/ui";
import { fmtNum, isNum } from "@/components/org/viz/vizNum";
import { isStruck, rendersValue, stateTitle } from "@/components/org/viz/states";
import { MatrixHatchDefs, MatrixMark, cellInk } from "@/components/org/viz/matrixMark";
import { MatrixEmpty, MatrixSrTable, cellAt, matrixAriaLabel, type MatrixGridProps } from "@/components/org/viz/matrixShared";

export type { MatrixCell, MatrixRow } from "@/components/org/viz/matrixShared";

/** Fill tint under a printed value — a measurement reads as a colour field, the ink stays legible. */
const FILL_ALPHA = 0.55;

/** The subject track flexes between a comfortable minimum and a reading maximum; each axis track
 *  holds a three-digit mono figure with air around it. One template for the head and every row. */
const template = (axes: number) => `minmax(12rem, 22rem) repeat(${axes}, minmax(3.5rem, 5.5rem))`;

export function MatrixGrid({ axes, rows, title = "Matrix", className = "" }: MatrixGridProps) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;

  if (axes.length === 0 || rows.length === 0) return <MatrixEmpty title={title} className={className} />;

  const columns = template(axes.length);

  return (
    <div className={className}>
      {/* One accessible name for the drawing, built from the cells it paints. The sr-only table sits
          OUTSIDE this element: an `img` role makes its children presentational. */}
      <div role="img" aria-label={matrixAriaLabel(title, axes, rows)} className="relative">
        <MatrixHatchDefs />
        <div className="grid" style={{ gridTemplateColumns: columns }}>
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
            data-row={row.id}
            className="grid border-b border-divider/50 last:border-b-0"
            style={{
              gridTemplateColumns: columns,
              opacity: animate ? 1 : 0,
              transition: reduced ? undefined : `opacity 0.4s ease-out ${Math.min(ri * 45, 360)}ms`,
            }}
          >
            <div
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
              return (
                <div
                  key={`${row.id}-${a}`}
                  data-cell={`${row.id}:${a}`}
                  data-state={cell.state}
                  title={stateTitle(cell.state, `${row.label} · ${a}`)}
                  className="relative h-10"
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

      <MatrixSrTable title={title} axes={axes} rows={rows} />
    </div>
  );
}
