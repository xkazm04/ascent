"use client";

// One repo's lane on the loop track — the /about-org echo of the cockpit's `LaneRail`
// (src/features/inflight/live/cockpit/LaneRail.tsx): a hairline rail with a stop per loop verb, a
// marker that GLIDES between stops rather than teleporting, and the counters the run produced
// rendered beside the rail as counters, never as stops of their own.
//
// The geometry lives here so the track head, the lane rails and the return arc all read stop
// positions from one function; a second copy is how an arrow ends up pointing between two stops.

import { deltaHex, fmtDelta } from "@/components/ui";
import { LOOP_STEPS } from "./loopSteps";
import { segment } from "./aboutOrgLoopMotion";

export const STOP_COUNT = LOOP_STEPS.length;

/** Centre of stop `i` as a percentage of the rail's width. Accepts fractional positions mid-glide. */
export const stopPct = (pos: number): number => ((pos + 0.5) / STOP_COUNT) * 100;

export interface TrackLane {
  repo: string;
  /** Stop index the lane sat at when the cycle opened, and the one it reached. */
  from: number;
  to: number;
  commits: number;
  closed: number;
  /** Overall movement this lane produced once both ends were measured. */
  lift: number;
}

/** Stagger: lanes leave in sequence so the track reads as a fleet in motion, not one synchronised jump. */
const laneDelay = (i: number) => i * 0.11;
const LANE_SPAN = 0.56;

/** How far through its glide lane `i` is at playhead `p`, 0..1. Also drives its counters. */
export const laneProgress = (i: number, p: number): number => segment(p, laneDelay(i), LANE_SPAN);

/** Where lane `i` sits at playhead `p` — fractional between stops while it is still moving. */
export function lanePos(lane: TrackLane, i: number, p: number): number {
  return lane.from + (lane.to - lane.from) * laneProgress(i, p);
}

export function LoopLane({ lane, index, p }: { lane: TrackLane; index: number; p: number }) {
  const q = laneProgress(index, p);
  const pos = lanePos(lane, index, p);
  const pct = stopPct(pos);
  const moving = q > 0 && q < 1 && lane.to !== lane.from;
  // Counters accrue with the work, so they must not be readable before the lane has done it.
  const commits = Math.round(lane.commits * q);
  const closed = Math.round(lane.closed * q);
  const lift = Math.round(lane.lift * q);

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 truncate type-mono-sm text-slate-200">{lane.repo}</span>
        <span className="shrink-0 type-caption tabular-nums text-slate-500">
          {commits} commits · {closed} closed
          <span className="ml-2" style={{ color: deltaHex(lift) }}>
            {fmtDelta(lift)}
          </span>
        </span>
      </div>

      <div className="relative mt-2 h-5" aria-hidden>
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-divider" />
        <div
          className="absolute top-1/2 h-px -translate-y-1/2 bg-accent/50"
          style={{ left: 0, width: `${pct}%` }}
        />
        {LOOP_STEPS.map((s, i) => (
          <span
            key={s.n}
            className={`absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
              i <= Math.round(pos) ? "bg-accent/70" : "bg-divider"
            }`}
            style={{ left: `${stopPct(i)}%` }}
          />
        ))}
        <span
          className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent bg-accent/40 ${
            moving ? "live-dot" : ""
          }`}
          style={{ left: `${pct}%` }}
        />
      </div>

      {/* The lane's state in words — the rail is decoration for a sighted reader, this is the fact. */}
      <span className="sr-only">
        {lane.repo}: at {LOOP_STEPS[Math.round(pos)]!.title}, {lane.commits} commits, {lane.closed} follow-ups
        closed, overall {fmtDelta(lane.lift)}.
      </span>
    </li>
  );
}
