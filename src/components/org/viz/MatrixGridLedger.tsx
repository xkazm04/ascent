"use client";

// LEDGER — the matrix as a typeset index page.
//
// Metaphor: a dense editorial ledger, the way "The Index" sets a table — a label column that takes
// the width it needs, a mono-uppercase column head sitting on the one hairline, and one hairline
// per line of the ledger. Why it differs from the baseline: nothing here is drawn in viewBox units.
// Layout is CSS grid, so every glyph is set in the semantic `type-*` scale (BRAND.md) at the size it
// was designed at, whatever the container is doing — the baseline's 9/10/11-unit SVG text scaled
// with the panel width and landed tiny in a narrow column and huge in a wide one. The row label is
// a real text column (`minmax`), so it truncates only when the panel genuinely cannot hold it, and
// the header wraps like text does instead of being ellipsized at eight characters.
//
// The cell keeps the SVG encoding (matrixMark.tsx): the ONE hatch, the dash array, the accent ring.
// A hatched or void cell never prints a numeral — `rendersValue` gates the <span>, structurally.

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { scoreHex } from "@/lib/ui";
import { fmtNum, isNum } from "@/components/org/viz/vizNum";
import { isStruck, rendersValue, stateTitle } from "@/components/org/viz/states";
import { MatrixHatchDefs, MatrixMark, cellInk } from "@/components/org/viz/matrixMark";
import {
  MATRIX_CAVEAT,
  MatrixEmpty,
  MatrixSrTable,
  cellAt,
  type MatrixGridProps,
} from "@/components/org/viz/matrixShared";

/** Fill tint under a printed value — a measurement reads as a colour field, the ink stays legible. */
const FILL_ALPHA = 0.55;

export function MatrixGridLedger({ axes, rows, title = "Matrix", className = "" }: MatrixGridProps) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;

  if (axes.length === 0 || rows.length === 0) return <MatrixEmpty title={title} className={className} />;

  // The label column flexes; the cells share the rest equally, never narrower than a three-digit
  // mono figure with air around it. One template, applied to the head and every row.
  const template = `minmax(7.5rem, 1.6fr) repeat(${axes.length}, minmax(3.5rem, 1fr))`;

  return (
    <div className={`relative ${className}`}>
      <MatrixHatchDefs />
      <div aria-hidden className="grid" style={{ gridTemplateColumns: template }}>
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
          aria-hidden
          data-row={row.id}
          className="grid border-b border-divider/50 last:border-b-0"
          style={{
            gridTemplateColumns: template,
            opacity: animate ? 1 : 0,
            transition: reduced ? undefined : `opacity 0.4s ease-out ${Math.min(ri * 45, 360)}ms`,
          }}
        >
          <div title={row.label} className="type-label min-w-0 self-center truncate py-1 pr-3 tracking-[0.06em] text-slate-300">
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

      <p className="sr-only">{MATRIX_CAVEAT}</p>
      <MatrixSrTable title={title} axes={axes} rows={rows} />
    </div>
  );
}
