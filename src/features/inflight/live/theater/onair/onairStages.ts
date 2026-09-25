// The six-step stage track the desk and the wall share (plan · read · edit · check · commit · land),
// and where every lane phase sits on it. Presentation only: the phase WORDS come from the one
// vocabulary (`lanePhaseLabel`, via `lanePhaseWords`); this maps a phase to a stop and a tone.

import type { LaneActivity, LanePhase } from "@/lib/local/runner-types";

export const STAGE_STEPS = ["plan", "read", "edit", "verify", "commit", "land"] as const;
export type StageStep = (typeof STAGE_STEPS)[number];
/** A stop on the track, or a state off it (queued, held, finished, failed). */
export type OnAirStage = StageStep | "wait" | "held" | "done" | "fail";

export const STAGE_WORD: Record<StageStep, string> = { plan: "PLAN", read: "READ", edit: "EDIT", verify: "CHECK", commit: "COMMIT", land: "LAND" };

const PHASE_STAGE: Record<LanePhase, OnAirStage> = {
  queued: "wait",
  planning: "plan",
  baseline: "plan",
  "agent-reading": "read",
  "agent-editing": "edit",
  "agent-thinking": "edit",
  "agent-quiet": "edit",
  verifying: "verify",
  installing: "verify",
  committing: "commit",
  landing: "land",
  rescanning: "land",
  held: "held",
  done: "done",
  error: "fail",
};

const PHASE_SHORT: Record<LanePhase, string> = {
  queued: "QUEUED",
  planning: "PLANNING",
  baseline: "BASELINE",
  "agent-reading": "READING",
  "agent-editing": "EDITING",
  "agent-thinking": "THINKING",
  "agent-quiet": "QUIET",
  verifying: "VERIFYING",
  installing: "INSTALLING",
  committing: "COMMITTING",
  landing: "LANDING",
  rescanning: "RESCANNING",
  held: "HELD",
  done: "DONE",
  error: "FAILED",
};

const WORKING: ReadonlySet<LanePhase> = new Set<LanePhase>([
  "planning",
  "baseline",
  "agent-reading",
  "agent-editing",
  "agent-thinking",
  "agent-quiet",
  "verifying",
  "installing",
  "committing",
  "landing",
  "rescanning",
]);

export const phaseStage = (p: LanePhase): OnAirStage => PHASE_STAGE[p] ?? "edit";
export const phaseShort = (p: LanePhase): string => PHASE_SHORT[p] ?? "WORKING";
export const laneWorking = (p: LanePhase): boolean => WORKING.has(p);

/** The index of a stage on the six-step track (-1 when it is off the track). */
export const stageIndex = (s: OnAirStage): number => (STAGE_STEPS as readonly string[]).indexOf(s);

/** On camera: working, and past the plan (a plan-stage lane has no file to show yet). */
export const onCamera = (p: LanePhase): boolean => laneWorking(p) && phaseStage(p) !== "plan";

export type LitTone = "read" | "edit" | "write";
export const litTone = (kind: LaneActivity["kind"]): LitTone => (kind === "edit" ? "edit" : kind === "write" ? "write" : "read");
