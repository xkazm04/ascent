// Which repositories moved this week, on the axis that decides what counts as a move.
//
// Beyond-noise movers sit clear of the shaded band; `held` sits inside it; `onboarded` is a lifetime
// delta (or a name at the origin when there is no comparable pair — never a printed 0).

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

function markPhrase(m: MoveMark): string {
  if (m.kind === "held") return `${m.name} ${signedDelta(m.d ?? NaN)}, held within the ±${NOISE}-point noise band`;
  if (m.kind === "onboarded") {
    return m.d == null
      ? `${m.name}, onboarded this week (no prior scan to compare)`
      : `${m.name} ${signedDelta(m.d)}, onboarded this week (lifetime, not a week's move)`;
  }
  return `${m.name} ${signedDelta(m.d ?? NaN)}${m.crossedLevel ? `, crossing from ${m.from} to ${m.to}` : ""}`;
}

function sideLabel(m: MoveMark): string | null {
  if (m.crossedLevel) return `${m.from}→${m.to}`;
  if (m.kind === "held") return "held";
  if (m.kind === "onboarded") return "new";
  return null;
}

export function DigestMoveAxis({ marks, extent }: { marks: MoveMark[]; extent: number }) {
  const H = HEAD_H + marks.length * ROW_H;
  const ariaLabel =
    `Repository movement this week, in overall score points. ` +
    marks.map(markPhrase).join("; ") +
    `. The shaded band is ±${NOISE} points of scan-to-scan noise.`;

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
          const d = m.d;
          const x = d != null ? dx(d, extent) : MID;
          const hex = deltaHex(d ?? NaN);
          const side = sideLabel(m);
          return (
            <g key={m.key} data-mover={m.key} data-kind={m.kind} data-crossed={m.crossedLevel ? "1" : "0"}>
              <text x={0} y={mid + 3} fontSize={9} className="fill-slate-300 font-mono">
                {m.name}
              </text>
              {d != null && (
                <line x1={MID} y1={mid} x2={x} y2={mid} stroke={hex} strokeWidth={2} strokeOpacity={0.55} strokeLinecap="round" />
              )}
              <circle cx={x} cy={mid} r={3.5} fill={hex} stroke="var(--color-surface-strong)" strokeWidth={1} />
              {d != null && (
                <text
                  x={d > 0 ? x + 6 : x - 6}
                  y={mid + 3}
                  textAnchor={d > 0 ? "start" : "end"}
                  fontSize={8.5}
                  className="font-mono tabular-nums"
                  fill={hex}
                >
                  {signedDelta(d)}
                </text>
              )}
              {side && (
                <text x={W} y={mid + 3} textAnchor="end" fontSize={8} className="fill-slate-500 font-mono">
                  {side}
                </text>
              )}
              <title>{markPhrase(m)}</title>
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
              <td>{m.d == null ? "not measured" : signedDelta(m.d)}</td>
              <td>{m.crossedLevel ? `${m.from} to ${m.to}` : m.kind === "held" ? "held" : m.kind === "onboarded" ? "onboarded" : m.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
