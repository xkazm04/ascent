// The week, per dimension: where the fleet stands (0–100) and how far it moved, on one drawn axis.
//
// THE SENTENCE THIS CHART EXISTS TO STOP NEEDING — *"Where each dimension stands now, and how it
// moved over the week. An em dash is a missing measurement, not a zero."* It was hand-written in two
// tabs; Delivery removed its copy in Wave 1 by breaking its trend lines at a null day, and this is
// the other one. Three readings the sentence asked the reader to hold are now three marks:
//
//   a real move      → a bar reaching OUT of the shaded band, coloured by direction (deltaHex)
//   a within-noise hold → a bar that stays INSIDE the band. The band is the reason it is not a
//                      climb, so the band draws it; nothing has to say "flat (within noise)".
//   no measurement   → NO bar at all, a void rule across the lane, and — because the state is the
//                      kit's `missing`, whose `rendersValue()` is false — no numeral anywhere on the
//                      row. Not an em dash sitting in a column of numbers: nothing.
//
// Layout is an HTML grid in the `type-*` scale (the Ledger direction), so the labels, heads and
// figures keep their designed size whatever the panel width. The bars, the band and the void are SVG
// with no viewBox, in percentages of their cell. The band is drawn ONCE, on an overlay grid with the
// same column template, so it spans every row's lane exactly.
//
// Server-safe (no hooks, no motion): a digest is a static artifact people paste, and an entrance
// animation on a document is noise. Dependency-free on scoreHex/deltaHex, per §2.5.

import { isNum, r2, rendersValue, stateTitle } from "@/components/org/viz";
import { deltaHex, signedDelta } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import { COLUMN_HEAD, MarkSvg, VoidRule, pctLen } from "../barRowMarks";
import { NOISE, type DimBar } from "./digestViz";

/** label · score bar · score figure · week lane — one template for the head, the rows and the band. */
const TEMPLATE = "minmax(7rem, 1.3fr) minmax(3.5rem, 0.8fr) 2.5rem minmax(6rem, 1.2fr)";
const GRID = "grid gap-x-3";
/** Half the lane, in %, a bar may reach: a small inset keeps an outlier's end off the lane edge. */
const HALF = 47.3;

/** Delta → lane %, clamped so an outlier cannot draw past the axis it is measured on. */
const dx = (d: number, extent: number) => r2(50 + Math.max(-1, Math.min(1, d / extent)) * HALF);

function rowLabel(b: DimBar): string {
  if (!rendersValue(b.state)) return `${b.dimId} ${b.label}: ${b.now} now, no measurement for the week`;
  const move = b.withinNoise
    ? `held within the ±${NOISE}-point noise band`
    : `moved ${signedDelta(b.delta ?? 0)} points`;
  return `${b.dimId} ${b.label}: ${b.now} now, ${move}`;
}

function rowTitle(b: DimBar): string {
  return rendersValue(b.state)
    ? `${b.dimId} ${b.label} — ${b.now} now, ${b.withinNoise ? `held within the ±${NOISE}-point noise band` : `${signedDelta(b.delta ?? 0)} this week`}`
    : stateTitle(b.state, `${b.dimId} ${b.label} this week`);
}

export function DigestDimChart({ bars, extent }: { bars: DimBar[]; extent: number }) {
  const ariaLabel =
    `Fleet score and this week's move, per dimension. ${bars.map(rowLabel).join("; ")}. ` +
    `The shaded band is ±${NOISE} points of scan-to-scan noise; a row with no bar has no measurement and is not a zero.`;
  const bandLo = dx(-NOISE, extent);
  const bandHi = dx(NOISE, extent);

  return (
    <div>
      <div role="img" aria-label={ariaLabel}>
        <div aria-hidden className={`${GRID} items-end border-b border-divider pb-1.5`} style={{ gridTemplateColumns: TEMPLATE }}>
          <span />
          <span className={`${COLUMN_HEAD} col-span-2`}>score</span>
          <span className="type-micro flex items-baseline justify-between gap-1 font-mono tabular-nums text-slate-600">
            <span>−{extent}</span>
            <span className="uppercase tracking-[0.18em] text-slate-500">week</span>
            <span>+{extent}</span>
          </span>
        </div>

        <div className="relative">
          {/* the noise band, drawn once across every row: the reason a +1 is not a climb */}
          <div aria-hidden className={`absolute inset-0 ${GRID}`} style={{ gridTemplateColumns: TEMPLATE }}>
            <div className="col-start-4">
              <MarkSvg className="h-full">
                <rect
                  data-noise-band
                  x={pctLen(bandLo)}
                  y={0}
                  width={pctLen(bandHi - bandLo)}
                  height="100%"
                  fill="var(--color-divider)"
                  fillOpacity={0.35}
                />
                <line x1="50%" y1={0} x2="50%" y2="100%" stroke="var(--color-divider)" strokeWidth={1} />
              </MarkSvg>
            </div>
          </div>

          {bars.map((b) => {
            const bx = isNum(b.delta) ? dx(b.delta, extent) : 50;
            return (
              <div
                key={b.dimId}
                data-row={b.dimId}
                data-state={b.state}
                title={rowTitle(b)}
                className={`relative ${GRID} min-h-8 items-center border-b border-divider/50 py-1 last:border-b-0`}
                style={{ gridTemplateColumns: TEMPLATE }}
              >
                <span className="type-label leading-tight tracking-[0.14em] text-slate-400 [overflow-wrap:anywhere]">
                  {b.dimId} {b.label}
                </span>

                <MarkSvg className="h-1.5">
                  <rect x={0} y={0} width="100%" height="100%" rx={3} fill="var(--color-divider)" fillOpacity={0.4} />
                  <rect
                    data-score-bar
                    x={0}
                    y={0}
                    width={pctLen(Math.max(0, Math.min(100, b.now)))}
                    height="100%"
                    rx={3}
                    fill={scoreHex(b.now)}
                  />
                </MarkSvg>
                <span className="type-mono-sm text-right tabular-nums" style={{ color: scoreHex(b.now) }}>
                  {b.now}
                </span>

                <MarkSvg className="h-2">
                  {isNum(b.delta) ? (
                    <rect
                      data-delta-bar
                      x={pctLen(Math.min(50, bx))}
                      y={0}
                      width={pctLen(Math.max(0.9, Math.abs(bx - 50)))}
                      height="100%"
                      rx={1.5}
                      fill={deltaHex(b.delta)}
                    />
                  ) : (
                    // the void: no bar, no numeral — an absence you can point at
                    <VoidRule from={2} to={98} />
                  )}
                </MarkSvg>
              </div>
            );
          })}
        </div>
      </div>

      <table className="sr-only">
        <caption>Per-dimension fleet score and this week&apos;s move</caption>
        <thead>
          <tr>
            <th scope="col">Dimension</th>
            <th scope="col">Score</th>
            <th scope="col">This week</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.dimId}>
              <th scope="row">
                {b.dimId} {b.label}
              </th>
              <td>{b.now}</td>
              <td>
                {!rendersValue(b.state)
                  ? "No measurement"
                  : b.withinNoise
                    ? `${signedDelta(b.delta ?? 0)} — within the noise band`
                    : signedDelta(b.delta ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
