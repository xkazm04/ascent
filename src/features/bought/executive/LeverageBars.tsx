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
// Layout is HTML in the `type-*` scale (the Ledger direction): the title takes its own line and wraps
// instead of being cut at a character count, and the readout sits in a mono column as wide as the
// widest readout. Only the bar, its segment dividers, the rung tick and the void are SVG — with no
// viewBox, in percentages of the track — so the type never scales with the panel.
//
// Server-safe: no hooks, no handlers, no motion — nothing here needs a client boundary.

import { HATCH_ID, VizDefs, r2, stateFill, stateFillOpacity, stateStroke, stateTitle } from "@/components/org/viz";
import { MarkSvg, VoidRule, pctLen } from "../barRowMarks";
import { SEGMENT_CAP, leverageMax, leverageReadout, type LeverageBar } from "./leverageMoves";

/** Bar geometry inside the 16px track, in CSS pixels (no viewBox, so they cannot stretch). */
const BAR_Y = 3;
const BAR_H = 10;
const TRACK_H = 16;
/** The shortest drawn bar, as a share of the track — a projected gain never collapses to nothing. */
const MIN_BAR_PCT = 0.625;

export function LeverageBars({ bars, className = "" }: { bars: LeverageBar[]; className?: string }) {
  if (bars.length === 0) {
    return (
      <div role="img" aria-label="Fleet gaps: nothing to rank" className={`type-body-sm text-slate-500 ${className}`}>
        No shared gaps to rank
      </div>
    );
  }

  const max = leverageMax(bars);
  // A fleet with no projection anywhere has no domain to scale against: every row is a void, which
  // is exactly what `max === 0` should produce rather than a divide-by-zero full-width bar.
  const width = (v: number) => (max > 0 ? Math.max(MIN_BAR_PCT, r2((v / max) * 100)) : 0);
  // One readout column for every row, as wide (in the row's own mono `ch`) as the widest readout,
  // so each track is the same length and the bars stay on one shared scale.
  const readCh = Math.max(...bars.map((b) => leverageReadout(b).length));

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
      <div role="img" aria-label={ariaLabel} className="relative">
        {/* Referenced so the hatch id stays live for a future not-judged row without a second defs. */}
        <svg aria-hidden focusable="false" width={0} height={0} className="absolute">
          <VizDefs />
          <rect width={0} height={0} fill={`url(#${HATCH_ID})`} />
        </svg>
        {bars.map((b) => (
          <LeverageRow key={b.id} bar={b} barW={b.fleetPoints === null ? 0 : width(b.fleetPoints)} readCh={readCh} />
        ))}
      </div>

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

function LeverageRow({ bar: b, barW, readCh }: { bar: LeverageBar; barW: number; readCh: number }) {
  const tip =
    b.fleetPoints === null
      ? stateTitle(b.state, b.title)
      : `${b.title} — ${b.fleetPoints} fleet maturity points (+${b.perRepo} on each of ${b.repoCount}). ${b.reach}. Leverage ${b.leverage}.`;

  return (
    <div data-bar={b.id} data-state={b.state} className="border-b border-divider/50 py-2 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span title={b.title} className="type-body-sm line-clamp-2 min-w-0 text-slate-300 [overflow-wrap:anywhere]">
          {b.title}
        </span>
        <span className="type-label shrink-0 tracking-[0.18em] text-slate-500">{b.dimLabel}</span>
      </div>

      <div
        className="mt-1 grid items-center gap-x-3 font-mono type-caption"
        style={{ gridTemplateColumns: `minmax(0, 1fr) ${readCh}ch` }}
      >
        <div title={tip}>
          <MarkSvg className="h-4">
            {b.fleetPoints === null ? (
              // The void: a dashed rule where a bar would be. It marks the row without asserting a
              // magnitude for it, and `rendersValue(missing)` is why no numeral sits beside it.
              <VoidRule id={b.id} />
            ) : (
              <>
                <rect
                  x={0}
                  y={BAR_Y}
                  width={pctLen(barW)}
                  height={BAR_H}
                  rx={2}
                  fill={stateFill(b.state)}
                  fillOpacity={stateFillOpacity(b.state) * 0.7}
                  stroke={stateStroke(b.state)}
                  strokeWidth={1}
                />
                {/* One divider per affected repository: the reach is a property of the bar, not a
                    sentence beside it. Past the cap the rules would be sub-pixel, so they stop. */}
                {b.repoCount > 1 &&
                  b.repoCount <= SEGMENT_CAP &&
                  Array.from({ length: b.repoCount - 1 }, (_, k) => {
                    const x = pctLen(((k + 1) / b.repoCount) * barW);
                    return (
                      <line key={`s-${k}`} x1={x} y1={BAR_Y} x2={x} y2={BAR_Y + BAR_H} stroke="var(--color-divider)" strokeWidth={0.5} />
                    );
                  })}
                {/* The rung tick — where the repos that would cross a maturity level end. */}
                {b.liftsRepos > 0 && (
                  <line
                    data-rung={b.id}
                    x1={pctLen((b.liftsRepos / b.repoCount) * barW)}
                    y1={0}
                    x2={pctLen((b.liftsRepos / b.repoCount) * barW)}
                    y2={TRACK_H}
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                  >
                    <title>{`${b.liftsRepos} of ${b.repoCount} would advance to the next maturity level`}</title>
                  </line>
                )}
              </>
            )}
          </MarkSvg>
        </div>
        <span data-readout className="text-right tabular-nums text-slate-500">
          {leverageReadout(b)}
        </span>
      </div>
    </div>
  );
}
