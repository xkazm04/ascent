"use client";

// STRATA — the matrix as a stack of subject bands.
//
// Metaphor: the altimeter's rock strata. Each subject is one stratum: its name set as a line of
// body copy (never truncated — it has the whole width), a one-line takeaway beside it, and under it
// a `TILE_LEDGER` bed of stat tiles, one per axis, each a self-describing mono caption + typeset
// figure in the `Stat` voice. Why it differs from the baseline: the baseline is a grid you read
// across; this is a ledger you read down, and the cell is promoted from a 46-unit chip to a stat
// tile with a `type-figure` readout, so a score reads at the size the rest of the dashboard prints
// scores at. It trades density for legibility — a long list is taller here — which is exactly the
// trade the user should judge in the round.
//
// Encoding is unchanged (matrixMark.tsx): a hatched or void tile never prints a figure.

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { scoreHex } from "@/lib/ui";
import { TILE_LEDGER } from "@/components/org/shared/uiConstants";
import { fmtNum, isNum } from "@/components/org/viz/vizNum";
import { STATE_LABEL, isStruck, isVoid, rendersValue, stateTitle } from "@/components/org/viz/states";
import { MatrixHatchDefs, MatrixMark, cellInk } from "@/components/org/viz/matrixMark";
import {
  MATRIX_CAVEAT,
  MatrixEmpty,
  MatrixSrTable,
  cellAt,
  type MatrixGridProps,
  type MatrixRow,
} from "@/components/org/viz/matrixShared";

/** A tile is a large field; a lighter tint keeps the figure the loudest thing on it. */
const FILL_ALPHA = 0.32;

/** The band's takeaway: how much of this subject is actually a measurement. */
function takeaway(row: MatrixRow, axes: string[]): string {
  const cells = axes.map((_, i) => cellAt(row, i));
  const valued = cells.filter((c) => rendersValue(c.state) && isNum(c.score)).length;
  const unjudged = cells.filter((c) => c.state === "not-judged").length;
  const parts = [`${valued} of ${axes.length} measured`];
  if (unjudged > 0) parts.push(`${unjudged} not judged`);
  return parts.join(" · ");
}

export function MatrixGridStrata({ axes, rows, title = "Matrix", className = "" }: MatrixGridProps) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;

  if (axes.length === 0 || rows.length === 0) return <MatrixEmpty title={title} className={className} />;

  return (
    <div className={`relative ${className}`}>
      <MatrixHatchDefs />
      {rows.map((row, ri) => (
        <section
          key={row.id}
          aria-hidden
          data-row={row.id}
          className="border-b border-divider/50 py-3 first:pt-0 last:border-b-0"
          style={{
            opacity: animate ? 1 : 0,
            transition: reduced ? undefined : `opacity 0.4s ease-out ${Math.min(ri * 45, 360)}ms`,
          }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="type-body-sm font-medium text-slate-200 [overflow-wrap:anywhere]">{row.label}</span>
            <span className="type-micro font-mono tabular-nums text-slate-500">{takeaway(row, axes)}</span>
          </div>

          <div className={`mt-2 ${TILE_LEDGER} rounded-lg`} style={{ gridTemplateColumns: `repeat(${axes.length}, minmax(0, 1fr))` }}>
            {axes.map((a, ci) => {
              const cell = cellAt(row, ci);
              const base = isNum(cell.score) ? scoreHex(cell.score) : undefined;
              const printed = rendersValue(cell.state) && isNum(cell.score);
              const ink = cellInk(cell, FILL_ALPHA);
              const quiet = isVoid(cell.state) || cell.state === "not-judged";
              return (
                <div
                  key={`${row.id}-${a}`}
                  data-cell={`${row.id}:${a}`}
                  data-state={cell.state}
                  title={stateTitle(cell.state, `${row.label} · ${a}`)}
                  className="relative min-h-[3.75rem] bg-surface px-3 py-2"
                >
                  <MatrixMark state={cell.state} base={base} alpha={FILL_ALPHA} radius={0} inset="inset-0" />
                  <div className={`relative type-micro font-mono uppercase leading-snug tracking-[0.12em] ${quiet ? "text-slate-600" : "text-slate-400"}`}>
                    {a}
                  </div>
                  {printed ? (
                    <div
                      data-score
                      className={`relative mt-0.5 inline-block type-figure font-bold${ink ? "" : " text-slate-100"}`}
                      style={ink ? { color: ink } : undefined}
                    >
                      {fmtNum(cell.score, 0)}
                      {isStruck(cell.state) && <span data-strike className="absolute inset-x-0 top-1/2 h-px bg-slate-300/70" />}
                    </div>
                  ) : (
                    // The state word is the whole content of a tile with nothing to print: `not-judged`
                    // sits on its hatch, `missing` sits on nothing at all. Never a numeral.
                    <div className="relative mt-1 type-micro leading-snug text-slate-500">{STATE_LABEL[cell.state]}</div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <p className="sr-only">{MATRIX_CAVEAT}</p>
      <MatrixSrTable title={title} axes={axes} rows={rows} />
    </div>
  );
}
