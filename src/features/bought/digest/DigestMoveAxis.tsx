// Which repositories moved this week, on the axis that decides what counts as a move.
//
// THE SENTENCE THIS DRAWING EXISTS TO STOP NEEDING — *"Repos whose overall score crossed the noise
// band between the two ends of the week."* The noise band is a shaded band on a chart, not a
// sentence: `getOrgMovers` admits a repo only when `classifyDelta` puts it outside ±SCORE_NOISE_BAND,
// so every mark here is BY CONSTRUCTION clear of the shaded middle, and the drawing shows by how
// much. A reader who can see the band never has to be told the rule.
//
// A level crossing is the other thing a lead reads this section for, and it is a different fact from
// the size of the move: it rides the row as its own `L2→L3` mark rather than being inferred from the
// bar's length. Server-safe, no motion; colour is the direction triad via deltaHex.

import { deltaHex, signedDelta } from "@/components/org/shared/ui";
import { r2 } from "@/components/org/viz";
import { NOISE, type MoveMark } from "./digestViz";

const LABEL_W = 92;
const LANE_X = LABEL_W;
const LANE_W = 168;
const LEVEL_W = 46;
const W = LANE_X + LANE_W + LEVEL_W;
const ROW_H = 20;
const HEAD_H = 14;

const MID = LANE_X + LANE_W / 2;
const dx = (d: number, extent: number) => r2(MID + Math.max(-1, Math.min(1, d / extent)) * (LANE_W / 2 - 4));

export function DigestMoveAxis({ marks, extent }: { marks: MoveMark[]; extent: number }) {
  const H = HEAD_H + marks.length * ROW_H;
  const ariaLabel =
    `Repository movement this week, in overall score points. ` +
    marks
      .map(
        (m) =>
          `${m.name} ${signedDelta(m.d)}${m.crossedLevel ? `, crossing from ${m.from} to ${m.to}` : ""}`,
      )
      .join("; ") +
    `. The shaded band is ±${NOISE} points of scan-to-scan noise; every repository shown moved clear of it.`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>

        <text x={LANE_X} y={HEAD_H - 4} fontSize={7} className="fill-slate-600 font-mono tabular-nums">
          −{extent}
        </text>
        <text x={MID} y={HEAD_H - 4} textAnchor="middle" fontSize={7} className="fill-slate-500 font-mono uppercase tracking-[0.18em]">
          Δ overall
        </text>
        <text x={LANE_X + LANE_W} y={HEAD_H - 4} textAnchor="end" fontSize={7} className="fill-slate-600 font-mono tabular-nums">
          +{extent}
        </text>

        <rect
          data-noise-band
          x={dx(-NOISE, extent)}
          y={HEAD_H}
          width={r2(dx(NOISE, extent) - dx(-NOISE, extent))}
          height={marks.length * ROW_H}
          fill="var(--color-divider)"
          fillOpacity={0.35}
        />
        <line x1={MID} y1={HEAD_H} x2={MID} y2={H} stroke="var(--color-divider)" strokeWidth={1} />

        {marks.map((m, i) => {
          const mid = HEAD_H + i * ROW_H + ROW_H / 2;
          const x = dx(m.d, extent);
          const hex = deltaHex(m.d);
          return (
            <g key={m.key} data-mover={m.key} data-crossed={m.crossedLevel ? "1" : "0"}>
              <text x={0} y={mid + 3} fontSize={9} className="fill-slate-300 font-mono">
                {m.name}
              </text>
              {/* the stem measures the distance from "no move" to this one, past the band edge */}
              <line x1={MID} y1={mid} x2={x} y2={mid} stroke={hex} strokeWidth={2} strokeOpacity={0.55} strokeLinecap="round" />
              <circle cx={x} cy={mid} r={3.5} fill={hex} stroke="var(--color-surface-strong)" strokeWidth={1} />
              <text
                x={m.d > 0 ? x + 6 : x - 6}
                y={mid + 3}
                textAnchor={m.d > 0 ? "start" : "end"}
                fontSize={8.5}
                className="font-mono tabular-nums"
                fill={hex}
              >
                {signedDelta(m.d)}
              </text>
              {m.crossedLevel && (
                <text x={W} y={mid + 3} textAnchor="end" fontSize={8} className="fill-slate-500 font-mono">
                  {m.from}→{m.to}
                </text>
              )}
              <title>
                {`${m.name} — ${signedDelta(m.d)} overall this week${m.crossedLevel ? `, crossing ${m.from}→${m.to}` : ""}. Clear of the ±${NOISE}-point noise band.`}
              </title>
            </g>
          );
        })}
      </svg>

      <table className="sr-only">
        <caption>Repository movement this week, in overall score points</caption>
        <thead>
          <tr>
            <th scope="col">Repository</th>
            <th scope="col">Δ overall</th>
            <th scope="col">Level</th>
          </tr>
        </thead>
        <tbody>
          {marks.map((m) => (
            <tr key={m.key}>
              <th scope="row">{m.name}</th>
              <td>{signedDelta(m.d)}</td>
              <td>{m.crossedLevel ? `${m.from} to ${m.to}` : m.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
