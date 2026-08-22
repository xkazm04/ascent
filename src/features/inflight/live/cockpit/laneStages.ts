// LANE RAIL geometry — where a lane's marker sits on its stage rail. Pure, so the one rule the rail
// depends on ("a marker never moves backwards, and never sits at a stop the server never reported")
// is testable without a DOM.
//
// The stops are the lane's REAL observable states and nothing else. There is deliberately no
// "commits" stop: `LoopLaneRecord` has no such phase — commits are a COUNTER the agent accumulates
// while the lane is `dispatching`, so a stop for them would park the marker at a state the engine
// never enters and would read as progress that had not happened. The counter is rendered as a
// counter, next to the rail.
//
// An `error` lane keeps the marker at the last stop it is known to have reached (its `stage`, else
// `dispatching` once it started, else `queued`) — an error is not a position of its own.

import { SCAN_SUBSTAGES, SUBSTAGE_LABEL, isSubstageFrame } from "@/lib/scan-stage";
import type { LoopLanePhase } from "./loopTypes";

export interface LaneStop {
  id: string;
  /** Rail caption — kept to one short word so nine of them fit a narrow rail. */
  label: string;
  /** True for the six rescan sub-stages, which the rail groups under one "rescanning" bracket. */
  rescan: boolean;
}

export const LANE_STOPS: readonly LaneStop[] = [
  { id: "queued", label: "Queued", rescan: false },
  { id: "dispatching", label: "Agent", rescan: false },
  ...SCAN_SUBSTAGES.map((s) => ({ id: s, label: SUBSTAGE_LABEL[s], rescan: true })),
  { id: "done", label: "Done", rescan: false },
];

const INDEX_OF = new Map(LANE_STOPS.map((s, i) => [s.id, i]));
const FIRST_RESCAN = LANE_STOPS.findIndex((s) => s.rescan);
const LAST = LANE_STOPS.length - 1;

/** The minimum shape the rail reads off a lane — a `LoopLaneRecord` satisfies it structurally. */
export interface LanePosition {
  phase: LoopLanePhase;
  stage: string | null;
  startedAt?: string | null;
}

/** Index into LANE_STOPS of the stop this lane has reached. Always within bounds. */
export function laneStopIndex(lane: LanePosition): number {
  const staged = isSubstageFrame(lane.stage) ? INDEX_OF.get(lane.stage) : undefined;
  switch (lane.phase) {
    case "queued":
      return 0;
    case "dispatching":
      return 1;
    case "rescanning":
      // No sub-stage frame yet → the head of the rescan bracket, not an invented sub-stage.
      return staged ?? FIRST_RESCAN;
    case "done":
      return LAST;
    case "error":
      return staged ?? (lane.startedAt ? 1 : 0);
    default:
      return 0;
  }
}

/** Marker position as a percentage of the rail's width — what the CSS transition animates. */
export function laneMarkerPct(lane: LanePosition): number {
  return (laneStopIndex(lane) / LAST) * 100;
}

/** The stop the lane is sitting at (the one that takes the heartbeat while the lane is live). */
export function laneActiveStop(lane: LanePosition): LaneStop {
  return LANE_STOPS[laneStopIndex(lane)]!;
}

/** A lane is live while it is doing something — the only state that earns a pulsing marker. */
export const laneIsLive = (phase: LoopLanePhase): boolean => phase === "dispatching" || phase === "rescanning";

/** One-line caption for the lane's current state, for the rail's mono status column. */
export function laneCaption(lane: LanePosition): string {
  if (lane.phase === "queued") return "queued";
  if (lane.phase === "done") return "done";
  if (lane.phase === "error") return "error";
  if (lane.phase === "dispatching") return "agent working";
  return isSubstageFrame(lane.stage) ? `rescanning · ${SUBSTAGE_LABEL[lane.stage]}` : "rescanning";
}
