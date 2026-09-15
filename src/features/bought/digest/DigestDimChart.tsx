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
// Server-safe (no hooks, no motion): a digest is a static artifact people paste, and an entrance
// animation on a document is noise. Dependency-free SVG on scoreHex/deltaHex, per §2.5.

import { VOID_DASH, isNum, r2, rendersValue, stateTitle } from "@/components/org/viz";
import { deltaHex, signedDelta } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import { NOISE, type DimBar } from "./digestViz";

const LABEL_W = 116;
const SCORE_X = LABEL_W;
const SCORE_W = 78;
const NUM_X = SCORE_X + SCORE_W + 20;
const LANE_X = NUM_X + 10;
const LANE_W = 112;
const W = LANE_X + LANE_W;
const ROW_H = 20;
const HEAD_H = 15;
const BAR_H = 8;

const MID = LANE_X + LANE_W / 2;
/** Delta → x, clamped inside the lane so an outlier cannot draw past the axis it is measured on. */
const dx = (d: number, extent: number) => r2(MID + Math.max(-1, Math.min(1, d / extent)) * (LANE_W / 2 - 3));

function rowLabel(b: DimBar): string {
  if (!rendersValue(b.state)) return `${b.dimId} ${b.label}: ${b.now} now, no measurement for the week`;
  const move = b.withinNoise
    ? `held within the ±${NOISE}-point noise band`
    : `moved ${signedDelta(b.delta ?? 0)} points`;
  return `${b.dimId} ${b.label}: ${b.now} now, ${move}`;
}

export function DigestDimChart({ bars, extent }: { bars: DimBar[]; extent: number }) {
  const H = HEAD_H + bars.length * ROW_H;
  const ariaLabel =
    `Fleet score and this week's move, per dimension. ${bars.map(rowLabel).join("; ")}. ` +
    `The shaded band is ±${NOISE} points of scan-to-scan noise; a row with no bar has no measurement and is not a zero.`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>

        <text x={SCORE_X} y={HEAD_H - 5} fontSize={7} className="fill-slate-500 font-mono uppercase tracking-[0.18em]">
          score
        </text>
        <text x={MID} y={HEAD_H - 5} textAnchor="middle" fontSize={7} className="fill-slate-500 font-mono uppercase tracking-[0.18em]">
          week
        </text>
        <text x={LANE_X} y={HEAD_H - 5} fontSize={7} className="fill-slate-600 font-mono tabular-nums">
          −{extent}
        </text>
        <text x={W} y={HEAD_H - 5} textAnchor="end" fontSize={7} className="fill-slate-600 font-mono tabular-nums">
          +{extent}
        </text>

        {/* the noise band, drawn once across every row: the reason a +1 is not a climb */}
        <rect
          data-noise-band
          x={dx(-NOISE, extent)}
          y={HEAD_H}
          width={r2(dx(NOISE, extent) - dx(-NOISE, extent))}
          height={bars.length * ROW_H}
          fill="var(--color-divider)"
          fillOpacity={0.35}
        />
        <line x1={MID} y1={HEAD_H} x2={MID} y2={H} stroke="var(--color-divider)" strokeWidth={1} />

        {bars.map((b, i) => {
          const y = HEAD_H + i * ROW_H;
          const mid = y + ROW_H / 2;
          const bx = isNum(b.delta) ? dx(b.delta, extent) : MID;
          return (
            <g key={b.dimId} data-row={b.dimId} data-state={b.state}>
              <text x={0} y={mid + 3} fontSize={8.5} className="fill-slate-400 font-mono uppercase tracking-[0.14em]">
                {b.dimId} {b.label}
              </text>

              <rect x={SCORE_X} y={mid - 3} width={SCORE_W} height={6} rx={3} fill="var(--color-divider)" fillOpacity={0.4} />
              <rect
                data-score-bar
                x={SCORE_X}
                y={mid - 3}
                width={r2((Math.max(0, Math.min(100, b.now)) / 100) * SCORE_W)}
                height={6}
                rx={3}
                fill={scoreHex(b.now)}
              />
              <text x={NUM_X} y={mid + 3.5} textAnchor="end" fontSize={9.5} className="font-mono tabular-nums" fill={scoreHex(b.now)}>
                {b.now}
              </text>

              {isNum(b.delta) ? (
                <rect
                  data-delta-bar
                  x={r2(Math.min(MID, bx))}
                  y={mid - BAR_H / 2}
                  width={r2(Math.max(1, Math.abs(bx - MID)))}
                  height={BAR_H}
                  rx={1.5}
                  fill={deltaHex(b.delta)}
                />
              ) : (
                // the void: no bar, no numeral — an absence you can point at
                <line
                  data-void
                  x1={LANE_X + 2}
                  y1={mid}
                  x2={W - 2}
                  y2={mid}
                  stroke="var(--color-divider)"
                  strokeWidth={1}
                  strokeDasharray={VOID_DASH}
                />
              )}
              <title>
                {rendersValue(b.state)
                  ? `${b.dimId} ${b.label} — ${b.now} now, ${b.withinNoise ? `held within the ±${NOISE}-point noise band` : `${signedDelta(b.delta ?? 0)} this week`}`
                  : stateTitle(b.state, `${b.dimId} ${b.label} this week`)}
              </title>
            </g>
          );
        })}
      </svg>

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
