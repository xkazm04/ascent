"use client";

// State over time, one lane per subject — the replacement for
// "a dash under State means the control was not readable at the last observation — missing evidence,
//  not a finding."
//
// The lane is a dotted rule (the unobserved ground), and an interval we actually observed is painted
// on top of it. So an unobserved stretch is a VISIBLE GAP with no mark in it, a `not-judged` stretch
// hatches, and a `declared` stretch is a dashed outline — three different things that a dash in a
// table cannot tell apart. Change markers sit at every transition.

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { isNum, r2 } from "@/components/org/viz/vizNum";
import {
  KICKER_SVG_CLASS,
  STATE_LABEL,
  VOID_DASH,
  VizDefs,
  isStruck,
  isVoid,
  stateDash,
  stateFill,
  stateFillOpacity,
  stateStroke,
  stateStrokeWidth,
  stateTitle,
  type VizState,
} from "@/components/org/viz/states";

const W = 320;
const LABEL_W = 96;
const ROW_H = 22;
const SEG_H = 10;
const AXIS_H = 16;

export type TrackSegment = {
  /** Start of the interval, in the same numeric space as `start`/`end` (epoch ms is typical). */
  from: number;
  to: number;
  state: VizState;
  /** Short noun phrase for the interval — used in the `<title>` and the sr-only table. */
  label?: string;
  color?: string;
};

export type TrackRow = {
  id: string;
  /** The control / subject this lane is about. */
  label: string;
  segments: TrackSegment[];
};

export function StateTrack({
  rows,
  start,
  end,
  ticks = [],
  title = "State over time",
  className = "",
}: {
  rows: TrackRow[];
  start: number;
  end: number;
  /** Pre-formatted axis ticks — the caller owns date formatting, so no function prop crosses here. */
  ticks?: { at: number; label: string }[];
  title?: string;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;

  const validWindow = isNum(start) && isNum(end) && end > start;
  if (rows.length === 0 || !validWindow) {
    return (
      <div role="img" aria-label={`${title}: no observation window`} className={`type-body-sm text-slate-500 ${className}`}>
        No observation window
      </div>
    );
  }

  const trackW = W - LABEL_W;
  const x = (v: number) => r2(LABEL_W + ((Math.max(start, Math.min(end, isNum(v) ? v : start)) - start) / (end - start)) * trackW);
  const H = rows.length * ROW_H + AXIS_H;

  // Segments are sanitised once: non-finite bounds are dropped entirely rather than clamped into a
  // zero-width mark, and `missing` never draws (it is the gap).
  const lanes = rows.map((row) => ({
    ...row,
    drawn: row.segments
      .filter((s) => isNum(s.from) && isNum(s.to) && s.to > s.from)
      .sort((a, b) => a.from - b.from),
  }));

  const ariaLabel =
    `${title}: ${rows.length} ${rows.length === 1 ? "subject" : "subjects"} over one window. ` +
    lanes
      .map((l) =>
        l.drawn.length === 0
          ? `${l.label}: never observed`
          : `${l.label}: ${l.drawn.map((s) => STATE_LABEL[s.state].toLowerCase()).join(", then ")}`,
      )
      .join("; ") +
    ". A gap in a lane is an unobserved interval, not a zero.";

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        <VizDefs />

        {lanes.map((lane, ri) => {
          const cy = ri * ROW_H + ROW_H / 2;
          return (
            <g key={lane.id} data-lane={lane.id}>
              <text x={0} y={cy + 3} fontSize={10} className={KICKER_SVG_CLASS}>
                {lane.label}
              </text>
              {/* the unobserved ground: a dotted rule the observed intervals are painted onto */}
              <line
                data-ground
                x1={LABEL_W}
                x2={W}
                y1={cy}
                y2={cy}
                stroke="var(--color-divider)"
                strokeWidth={1}
                strokeDasharray={VOID_DASH}
              />
              <g
                style={{
                  opacity: animate ? 1 : 0,
                  transition: reduced ? undefined : `opacity 0.45s ease-out ${Math.min(ri * 60, 360)}ms`,
                }}
              >
                {lane.drawn.map((s, si) => {
                  const x1 = x(s.from);
                  const x2 = x(s.to);
                  const w = Math.max(2, x2 - x1);
                  const marker =
                    // A change marker at every transition BUT the window's own opening edge — the
                    // first segment starting at `start` is where the record begins, not a change.
                    si > 0 || s.from > start ? (
                      <line
                        key={`m-${si}`}
                        data-change
                        x1={x1}
                        x2={x1}
                        y1={cy - SEG_H / 2 - 3}
                        y2={cy + SEG_H / 2 + 3}
                        stroke="var(--color-accent)"
                        strokeWidth={1}
                      />
                    ) : null;
                  // `missing` draws nothing at all: the dotted ground is the encoding.
                  if (isVoid(s.state)) return marker;
                  return (
                    <g key={`s-${si}`}>
                      <rect
                        data-segment={s.state}
                        x={x1}
                        y={cy - SEG_H / 2}
                        width={w}
                        height={SEG_H}
                        rx={2}
                        fill={stateFill(s.state, s.color)}
                        fillOpacity={stateFillOpacity(s.state) * 0.7}
                        stroke={stateStroke(s.state, s.color)}
                        strokeWidth={stateStrokeWidth(s.state)}
                        strokeDasharray={stateDash(s.state)}
                      >
                        <title>{stateTitle(s.state, s.label ?? lane.label)}</title>
                      </rect>
                      {isStruck(s.state) && (
                        <line data-strike x1={x1} x2={x1 + w} y1={cy} y2={cy} stroke="var(--color-divider)" strokeWidth={1.5} />
                      )}
                      {marker}
                    </g>
                  );
                })}
              </g>
            </g>
          );
        })}

        {ticks
          .filter((t) => isNum(t.at))
          .map((t) => (
            <text key={`${t.at}-${t.label}`} x={x(t.at)} y={H - 4} textAnchor="middle" fontSize={9} className={KICKER_SVG_CLASS}>
              {t.label}
            </text>
          ))}
      </svg>

      <table className="sr-only">
        <caption>{`${title} — observed intervals by subject`}</caption>
        <thead>
          <tr>
            <th scope="col">Subject</th>
            <th scope="col">State</th>
            <th scope="col">Interval</th>
          </tr>
        </thead>
        <tbody>
          {lanes.map((lane) =>
            lane.drawn.length === 0 ? (
              <tr key={lane.id}>
                <th scope="row">{lane.label}</th>
                <td>{STATE_LABEL.missing}</td>
                <td>—</td>
              </tr>
            ) : (
              lane.drawn.map((s, si) => (
                <tr key={`${lane.id}-${si}`}>
                  <th scope="row">{si === 0 ? lane.label : `${lane.label} (continued)`}</th>
                  <td>{STATE_LABEL[s.state]}</td>
                  <td>{s.label ?? `${s.from} to ${s.to}`}</td>
                </tr>
              ))
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
