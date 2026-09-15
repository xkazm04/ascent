// Three bars against the green floor: where in the pipeline the fleet's dimension debt sits.
//
// The first sight under the "Dimensions by SDLC phase" rule, replacing the paragraph that used to
// count the debt without locating it. Dependency-free SVG on `linScale` + `scoreHex` + the kit's
// state vocabulary — no hand-picked colour, no second hatch. Server-safe (no hooks); the band rides
// the Overview's existing `stagger-children` entrance rather than adding one of its own.

import { linScale } from "@/components/report/chartScale";
import { scoreHex } from "@/lib/ui";
import {
  KICKER_SVG_CLASS,
  STATE_LABEL,
  VizDefs,
  isNum,
  isVoid,
  fmtNum,
  r2,
  rendersValue,
  stateFill,
  stateFillOpacity,
  stateStroke,
  stateStrokeWidth,
  stateTitle,
} from "@/components/org/viz";
import { GREEN_FLOOR, type PhaseStanding } from "./phaseStanding";

const LABEL_W = 116;
const TRACK_W = 300;
const VALUE_W = 34;
const ROW_H = 22;
const BAR_H = 11;
const W = LABEL_W + TRACK_W + VALUE_W;

export function PhaseStandingStrip({ phases, className = "" }: { phases: PhaseStanding[]; className?: string }) {
  if (phases.length === 0) {
    return (
      <div role="img" aria-label="Phase standing: no dimensions scored" className={`type-body-sm text-slate-500 ${className}`}>
        No dimension averages in this view
      </div>
    );
  }

  const H = phases.length * ROW_H + 10;
  const x = linScale(100, LABEL_W, TRACK_W);
  const floorX = r2(x(GREEN_FLOOR));

  const ariaLabel =
    `Fleet standing by SDLC phase, against the green floor of ${GREEN_FLOOR}. ` +
    phases
      .map((p) =>
        rendersValue(p.state) && isNum(p.avg)
          ? `${p.label}: ${p.avg}, ${p.owed.n} of ${p.owed.of} dimensions below green`
          : `${p.label}: ${STATE_LABEL[p.state].toLowerCase()}`,
      )
      .join("; ") +
    ". A hatched bar was not judged; an empty track has no measurement and is not a zero.";

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        <VizDefs />

        {phases.map((p, i) => {
          const y = i * ROW_H;
          const cy = y + ROW_H / 2;
          const base = isNum(p.avg) ? scoreHex(p.avg) : undefined;
          const len = rendersValue(p.state) && isNum(p.avg) ? Math.max(2, r2(x(p.avg) - LABEL_W)) : TRACK_W;
          return (
            <g key={p.id} data-phase={p.id} data-state={p.state}>
              <text x={0} y={cy + 3} fontSize={9} className={KICKER_SVG_CLASS}>
                {p.label}
              </text>
              {/* the track — always drawn, so a void is a locatable empty lane rather than a hole */}
              <rect x={LABEL_W} y={cy - BAR_H / 2} width={TRACK_W} height={BAR_H} rx={2} fill="none" stroke="var(--color-divider)" strokeWidth={1} strokeOpacity={0.5} />
              {!isVoid(p.state) && (
                <rect
                  data-bar
                  x={LABEL_W}
                  y={cy - BAR_H / 2}
                  width={len}
                  height={BAR_H}
                  rx={2}
                  fill={stateFill(p.state, base)}
                  fillOpacity={stateFillOpacity(p.state) * 0.55}
                  stroke={stateStroke(p.state, base)}
                  strokeWidth={stateStrokeWidth(p.state)}
                />
              )}
              {rendersValue(p.state) && isNum(p.avg) && (
                <text data-value x={W} y={cy + 4} textAnchor="end" fontSize={11} className="fill-slate-200 font-mono tabular-nums">
                  {fmtNum(p.avg, 0)}
                </text>
              )}
              <title>{`${stateTitle(p.state, p.label)} ${p.question}`}</title>
            </g>
          );
        })}

        {/* the green floor — the threshold the deleted sentence named in words ("below 65") */}
        <line x1={floorX} x2={floorX} y1={2} y2={phases.length * ROW_H - 2} stroke="var(--color-accent)" strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.7} />
        <text x={floorX} y={H - 1} textAnchor="middle" fontSize={8} className={KICKER_SVG_CLASS}>
          green {GREEN_FLOOR}
        </text>
      </svg>

      <table className="sr-only">
        <caption>Fleet standing by SDLC phase</caption>
        <thead>
          <tr>
            <th scope="col">Phase</th>
            <th scope="col">Average</th>
            <th scope="col">Dimensions below green</th>
          </tr>
        </thead>
        <tbody>
          {phases.map((p) => (
            <tr key={p.id}>
              <th scope="row">{p.label}</th>
              <td>{rendersValue(p.state) && isNum(p.avg) ? fmtNum(p.avg, 0) : STATE_LABEL[p.state]}</td>
              <td>{`${p.owed.n} of ${p.owed.of}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
