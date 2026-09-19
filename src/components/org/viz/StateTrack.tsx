"use client";

// State over time, one lane per subject — the replacement for
// "a dash under State means the control was not readable at the last observation — missing evidence,
//  not a finding."
//
// The lane is a dotted rule (the unobserved ground), and an interval we actually observed is painted
// on top of it. So an unobserved stretch is a VISIBLE GAP with no mark in it, a `not-judged` stretch
// hatches, and a `declared` stretch is a dashed outline — three different things that a dash in a
// table cannot tell apart. Change markers sit at every transition.
//
// Layout follows MatrixGrid's Ledger: every glyph is HTML in the semantic `type-*` scale, so a label
// reads at the size it was designed at whatever width the panel is. Each lane is one grid row — a
// real label column (it takes the width its longest subject needs, capped so it never eats the
// lane) and a lane SVG with NO viewBox, drawn in percentage x, so strokes and dashes never distort.
// The tick row is HTML positioned by `left %` under the lane column.

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { isNum, r2 } from "@/components/org/viz/vizNum";
import {
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

/** Lane height in CSS px — the SVG has no viewBox, so these are real pixels, not scaled units. */
const ROW_H = 28;
const CY = ROW_H / 2;
const SEG_H = 10;
/** Floor on a painted interval's width, in % of the lane (the old 2-of-224-unit floor), so a brief
 *  observation stays visible rather than collapsing to nothing. */
const MIN_SEG_PCT = 0.9;
/** The label column takes what its longest subject needs, never more than this share of the width. */
const TEMPLATE = "fit-content(40%) minmax(0, 1fr)";

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

/** A tick at the window's edge anchors inward so its label stays inside the lane. */
function tickShift(p: number): string {
  if (p <= 0) return "translate-x-0";
  if (p >= 100) return "-translate-x-full";
  return "-translate-x-1/2";
}

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

  /** Position along the lane, 0..100 %, clamped into the window. */
  const pos = (v: number) => r2(((Math.max(start, Math.min(end, isNum(v) ? v : start)) - start) / (end - start)) * 100);
  const pc = (v: number) => `${v}%`;

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

  const shownTicks = ticks.filter((t) => isNum(t.at));

  return (
    <div className={className}>
      <div role="img" aria-label={ariaLabel} title={ariaLabel} className="relative grid" style={{ gridTemplateColumns: TEMPLATE }}>
        <svg aria-hidden className="absolute h-0 w-0" focusable="false">
          <VizDefs />
        </svg>

        {lanes.map((lane, ri) => (
          <div key={lane.id} data-lane={lane.id} className="col-span-2 grid grid-cols-subgrid items-center">
            <div title={lane.label} className="type-label min-w-[6rem] truncate pr-3 tracking-[0.1em] text-slate-400">
              {lane.label}
            </div>
            <svg width="100%" height={ROW_H} className="block overflow-visible" focusable="false">
              {/* the unobserved ground: a dotted rule the observed intervals are painted onto */}
              <line
                data-ground
                x1={0}
                x2="100%"
                y1={CY}
                y2={CY}
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
                  const x1 = pos(s.from);
                  const w = r2(Math.max(MIN_SEG_PCT, pos(s.to) - x1));
                  const marker =
                    // A change marker at every transition BUT the window's own opening edge — the
                    // first segment starting at `start` is where the record begins, not a change.
                    si > 0 || s.from > start ? (
                      <line
                        key={`m-${si}`}
                        data-change
                        x1={pc(x1)}
                        x2={pc(x1)}
                        y1={CY - SEG_H / 2 - 3}
                        y2={CY + SEG_H / 2 + 3}
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
                        x={pc(x1)}
                        y={CY - SEG_H / 2}
                        width={pc(w)}
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
                        <line data-strike x1={pc(x1)} x2={pc(r2(x1 + w))} y1={CY} y2={CY} stroke="var(--color-divider)" strokeWidth={1.5} />
                      )}
                      {marker}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
        ))}

        {shownTicks.length > 0 && (
          <div className="col-span-2 grid grid-cols-subgrid">
            <div />
            <div className="relative mt-1 h-5">
              {shownTicks.map((t) => {
                const p = pos(t.at);
                return (
                  <span
                    key={`${t.at}-${t.label}`}
                    data-tick
                    className={`absolute top-0 whitespace-nowrap font-mono type-micro uppercase tabular-nums tracking-[0.12em] text-slate-500 ${tickShift(p)}`}
                    style={{ left: pc(p) }}
                  >
                    {t.label}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

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
