// The fleet's widest shared gaps, drawn on ONE proportional scale.
//
// The panel used to open with 232 characters explaining that the list was ranked by reach × impact ×
// dimension weight and that the projected gain was engine-true. A ranking a reader has to take on
// trust is a ranking that has not been drawn: this replaces the sentence with the bar it described.
// Length is `perRepo × repoCount` — the maturity points the whole fleet stands to gain — so the
// order is SEEN, and the per-repo gain is one segment of the same bar.
//
// Two deliberate restraints, both of them the demoted "somewhere to look next, not an order":
//   - no rank numerals and no call-to-action pill. The bars carry the order; a numbered list with a
//     highlighted first item is an instruction in visual form.
//   - a gap with no engine-true projection draws a dashed VOID, never a short bar. A short bar would
//     be a claim ("small gain"); the void is the truth ("nothing measured this").
//
// Server-safe: no hooks, no handlers, no motion — nothing here needs a client boundary.

import {
  HATCH_ID,
  KICKER_SVG_CLASS,
  VOID_DASH,
  VizDefs,
  stateFill,
  stateFillOpacity,
  stateStroke,
  stateTitle,
} from "@/components/org/viz";
import { SEGMENT_CAP, leverageMax, leverageReadout, type LeverageBar } from "./leverageMoves";

const W = 320;
const ROW_H = 30;
const PAD_B = 4;
const BAR_H = 9;
const BAR_DY = 15;
const TITLE_CHARS = 44;

/** SVG text cannot ellipsize; the full title rides in the mark's `<title>` and the sr-only table. */
function short(s: string): string {
  return s.length > TITLE_CHARS ? `${s.slice(0, TITLE_CHARS - 1).trimEnd()}…` : s;
}

export function LeverageBars({ bars, className = "" }: { bars: LeverageBar[]; className?: string }) {
  if (bars.length === 0) {
    return (
      <div role="img" aria-label="Fleet gaps: nothing to rank" className={`type-body-sm text-slate-500 ${className}`}>
        No shared gaps to rank
      </div>
    );
  }

  const max = leverageMax(bars);
  const H = bars.length * ROW_H + PAD_B;
  // A fleet with no projection anywhere has no domain to scale against: every row is a void, which
  // is exactly what `max === 0` should produce rather than a divide-by-zero full-width bar.
  const width = (v: number) => (max > 0 ? Math.max(2, Math.round((v / max) * W * 100) / 100) : 0);

  const ariaLabel =
    `Widest shared gaps across the fleet, ${bars.length} ranked by leverage. Bar length is the fleet-wide maturity points on the table. ` +
    bars
      .map((b) =>
        b.fleetPoints === null
          ? `${b.title}: no projected gain`
          : `${b.title}: ${b.fleetPoints} points across ${b.repoCount} repositories`,
      )
      .join("; ") +
    ".";

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        <VizDefs />
        {bars.map((b, i) => {
          const top = i * ROW_H;
          const y = top + BAR_DY;
          const barW = b.fleetPoints === null ? 0 : width(b.fleetPoints);
          const readout = leverageReadout(b);
          const outside = barW < W - 96;
          return (
            <g key={b.id} data-bar={b.id} data-state={b.state}>
              <text x={0} y={top + 9} fontSize={10} className="fill-slate-300">
                {short(b.title)}
              </text>
              <text x={W} y={top + 9} fontSize={8} textAnchor="end" className={KICKER_SVG_CLASS}>
                {b.dimLabel}
              </text>

              {b.fleetPoints === null ? (
                // The void: a dashed rule where a bar would be. It marks the row without asserting a
                // magnitude for it, and `rendersValue(missing)` is why no numeral sits beside it.
                <line
                  data-void={b.id}
                  x1={0}
                  y1={y + BAR_H / 2}
                  x2={W}
                  y2={y + BAR_H / 2}
                  stroke="var(--color-divider)"
                  strokeWidth={1}
                  strokeDasharray={VOID_DASH}
                >
                  <title>{stateTitle(b.state, b.title)}</title>
                </line>
              ) : (
                <>
                  <rect
                    x={0}
                    y={y}
                    width={barW}
                    height={BAR_H}
                    rx={2}
                    fill={stateFill(b.state)}
                    fillOpacity={stateFillOpacity(b.state) * 0.7}
                    stroke={stateStroke(b.state)}
                    strokeWidth={1}
                  >
                    <title>{`${b.title} — ${b.fleetPoints} fleet maturity points (+${b.perRepo} on each of ${b.repoCount}). ${b.reach}. Leverage ${b.leverage}.`}</title>
                  </rect>
                  {/* One divider per affected repository: the reach is a property of the bar, not a
                      sentence beside it. Past the cap the rules would be sub-pixel, so they stop. */}
                  {b.repoCount > 1 &&
                    b.repoCount <= SEGMENT_CAP &&
                    Array.from({ length: b.repoCount - 1 }, (_, k) => (
                      <line
                        key={`s-${k}`}
                        x1={((k + 1) / b.repoCount) * barW}
                        y1={y}
                        x2={((k + 1) / b.repoCount) * barW}
                        y2={y + BAR_H}
                        stroke="var(--color-divider)"
                        strokeWidth={0.5}
                      />
                    ))}
                  {/* The rung tick — where the repos that would cross a maturity level end. */}
                  {b.liftsRepos > 0 && (
                    <line
                      data-rung={b.id}
                      x1={(b.liftsRepos / b.repoCount) * barW}
                      y1={y - 3}
                      x2={(b.liftsRepos / b.repoCount) * barW}
                      y2={y + BAR_H + 3}
                      stroke="var(--color-accent)"
                      strokeWidth={2}
                    >
                      <title>{`${b.liftsRepos} of ${b.repoCount} would advance to the next maturity level`}</title>
                    </line>
                  )}
                </>
              )}

              <text
                x={outside ? barW + 5 : W}
                y={y + BAR_H - 1}
                fontSize={9}
                textAnchor={outside ? "start" : "end"}
                className="fill-slate-500 font-mono tabular-nums"
              >
                {readout}
              </text>
            </g>
          );
        })}
        {/* Referenced so the hatch id stays live for a future not-judged row without a second defs. */}
        <rect width={0} height={0} fill={`url(#${HATCH_ID})`} />
      </svg>

      <table className="sr-only">
        <caption>Widest shared gaps, ranked by leverage</caption>
        <thead>
          <tr>
            <th scope="col">Gap</th>
            <th scope="col">Dimension</th>
            <th scope="col">Per-repo gain</th>
            <th scope="col">Repositories</th>
            <th scope="col">Fleet points</th>
            <th scope="col">Would advance a level</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.id}>
              <th scope="row">{b.title}</th>
              <td>{b.dimLabel}</td>
              <td>{b.perRepo === null ? "not projected" : `+${b.perRepo}`}</td>
              <td>{b.reach}</td>
              <td>{b.fleetPoints === null ? "not projected" : b.fleetPoints}</td>
              <td>{b.liftsRepos}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
