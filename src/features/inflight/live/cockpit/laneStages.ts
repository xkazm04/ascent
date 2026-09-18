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
// THE DISPATCHING STRETCH IS FOUR STOPS, not one (spark theater-upgrade). `dispatching` used to be a
// single "Agent" stop covering the planning session, the baseline check, the editing session and the
// result check — 25 minutes of one dot. The lane writes a `stage` for each of the others (`planning`,
// `verifying` twice, `installing`), and the baseline and the result check share the word `verifying`,
// so which one it is comes from the ONE phase derivation (`lane-phase.ts`), never from a second rule
// here. Captions come from the same place (`lanePhaseLabel`), so the rail and the theater cannot name
// one moment two ways.
//
// An `error` lane keeps the marker at the last stop it is known to have reached (its `stage` — a lane
// stage, a watchdog stage or a rescan sub-stage — else `dispatching` once it started, else `queued`) —
// an error is not a position of its own.

import { SCAN_SUBSTAGES, SUBSTAGE_LABEL, isSubstageFrame } from "@/lib/scan-stage";
import { deriveLanePhase, laneQuietForMs, lanePhaseLabel } from "@/lib/local/lane-phase";
import type { LaneActivity, LanePhase } from "@/lib/local/runner-types";
import type { LoopLanePhase } from "./loopTypes";

export interface LaneStop {
  id: string;
  /** Rail caption — kept to one short word so every stop fits a narrow rail. */
  label: string;
  /** True for the six rescan sub-stages, which the rail groups under one "rescanning" bracket. */
  rescan: boolean;
}

export const LANE_STOPS: readonly LaneStop[] = [
  { id: "queued", label: "Queued", rescan: false },
  { id: "planning", label: "Plan", rescan: false },
  { id: "baseline", label: "Baseline", rescan: false },
  { id: "dispatching", label: "Agent", rescan: false },
  { id: "installing", label: "Install", rescan: false },
  { id: "verifying", label: "Check", rescan: false },
  ...SCAN_SUBSTAGES.map((s) => ({ id: s, label: SUBSTAGE_LABEL[s], rescan: true })),
  { id: "done", label: "Done", rescan: false },
];

const INDEX_OF = new Map(LANE_STOPS.map((s, i) => [s.id, i]));
const at = (id: string): number => INDEX_OF.get(id)!;
const AGENT = at("dispatching");
const FIRST_RESCAN = LANE_STOPS.findIndex((s) => s.rescan);
const LAST = LANE_STOPS.length - 1;

/** The minimum shape the rail reads off a lane — a `LoopLaneRecord` satisfies it structurally. The live
 *  signal fields are optional: a lane written before them (or an outcome cell that does not carry them)
 *  reads exactly as it always did. */
export interface LanePosition {
  phase: LoopLanePhase;
  stage: string | null;
  startedAt?: string | null;
  activity?: readonly LaneActivity[];
  heartbeatAt?: string | null;
  stageAt?: string | null;
  planId?: string | null;
  executor?: string;
}

/** The lane's evidence, as the derivation reads it. */
const liveOf = (lane: LanePosition) => ({ tail: lane.activity ?? [], heartbeatAt: lane.heartbeatAt ?? null, stageAt: lane.stageAt ?? null });

/** The ONE derivation, fed from whatever the lane carries. */
function phaseOf(lane: LanePosition, now: number): LanePhase {
  return deriveLanePhase(
    {
      phase: lane.phase,
      stage: lane.stage,
      ...liveOf(lane),
      ...(lane.planId !== undefined ? { planned: lane.planId != null } : {}),
    },
    now,
  );
}

/** A watchdog stage (`lane-watchdog.ts`) a force-failed lane carries → the stop it was cut at. */
const CUT_AT: Record<string, string> = {
  plan: "planning",
  planning: "planning",
  baseline: "baseline",
  agent: "dispatching",
  deps: "installing",
  installing: "installing",
  verify: "verifying",
  verifying: "verifying",
  commit: "verifying",
};

/** The stop a `dispatching` lane's phase sits at. The agent's own sub-phases share the Agent stop;
 *  committing and landing come after the check, and before the rescan. */
const STOP_OF: Partial<Record<LanePhase, string>> = {
  planning: "planning",
  baseline: "baseline",
  installing: "installing",
  verifying: "verifying",
  committing: "verifying",
  landing: "verifying",
};

/** Index into LANE_STOPS of the stop this lane has reached. Always within bounds. Never depends on the
 *  clock: quiet decay renames the Agent stop's caption, it does not move the marker — so the derivation
 *  is fed a fixed instant (`0`, at which nothing has had time to go quiet). */
export function laneStopIndex(lane: LanePosition): number {
  const staged = isSubstageFrame(lane.stage) ? INDEX_OF.get(lane.stage) : undefined;
  switch (lane.phase) {
    case "queued":
      return 0;
    case "dispatching": {
      const stop = STOP_OF[phaseOf(lane, 0)];
      return stop ? at(stop) : AGENT;
    }
    case "rescanning":
      // No sub-stage frame yet → the head of the rescan bracket, not an invented sub-stage.
      return staged ?? FIRST_RESCAN;
    case "done":
      return LAST;
    case "error": {
      if (staged != null) return staged;
      if (lane.stage === "rescan" || lane.stage === "refresh") return FIRST_RESCAN;
      const cut = lane.stage ? CUT_AT[lane.stage] : undefined;
      if (cut) return at(cut);
      return lane.startedAt ? AGENT : 0;
    }
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

/** Does this lane carry ANY live signal? A lane written before the columns (or a remote lane, whose
 *  session Ascent never sees) has none, and deriving a sub-phase for it would be a claim nobody made. */
const hasLiveSignal = (lane: LanePosition): boolean =>
  lane.executor !== "remote-agent" && ((lane.activity?.length ?? 0) > 0 || lane.heartbeatAt != null || lane.stageAt != null);

/** The rail's lowercase caption style, over the one vocabulary's words. */
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** One-line caption for the lane's current state, for the rail's mono status column. */
export function laneCaption(lane: LanePosition, now: number = Date.now()): string {
  if (lane.phase === "queued") return "queued";
  if (lane.phase === "done") return "done";
  // A FORCE-FAILED lane carries the stage that was in flight when its deadline (or a stop) cut it —
  // `verify`, `agent`, `rescan`… (src/lib/local/lane-watchdog.ts). Printing it turns "error" into
  // "cycle 3 died in verification" on the rail itself. A rescan sub-stage is already covered by the
  // rail's own position, and an ordinary failure carries no stage at all, so both read as before.
  if (lane.phase === "error") return lane.stage && !isSubstageFrame(lane.stage) ? `error · ${lane.stage}` : "error";
  if (lane.phase === "dispatching") {
    // A named stage is a fact the lane wrote, so it is captioned even on a lane with no other signal.
    const phase = phaseOf(lane, now);
    if (!hasLiveSignal(lane) && !STOP_OF[phase]) return "agent working";
    return lower(lanePhaseLabel(phase, phase === "agent-quiet" ? laneQuietForMs(liveOf(lane), now) : null));
  }
  return isSubstageFrame(lane.stage) ? `rescanning · ${SUBSTAGE_LABEL[lane.stage]}` : "rescanning";
}
