// Pure stage-selector for the war-room's Dynamic-UI TV mode. Instead of full-screening the whole
// scrolling wall, TV mode shows ONE panel at a time, chosen by the fleet's current lifecycle state —
// this module owns the rule for WHICH panels are relevant right now and in what order. Kept pure
// (no React) so the "what shows when" contract is unit-testable without a renderer.

export type TvStageId = "scanning" | "decide" | "inflight" | "standing";

export interface TvContext {
  /** A live scan is streaming — the loud event that should take over the wall. */
  running: boolean;
  /** Open directions awaiting a triage decision. */
  triage: number;
  /** Draft PRs opened and being watched for merge. */
  inFlight: number;
}

export const TV_STAGE_LABEL: Record<TvStageId, string> = {
  scanning: "Scanning",
  decide: "Decide",
  inflight: "In flight",
  standing: "Standing",
};

/**
 * The ordered set of stages relevant to the current state. A running scan is the loud event, so it
 * takes the whole wall alone (no rotation away from a live scan). Otherwise the wall rotates through
 * the states that actually have something to show — pending decisions first (someone should act),
 * then the fleet's standing, then any PRs in flight. `standing` is always present as the resting view,
 * so the list is never empty.
 */
export function computeTvStages(ctx: TvContext): TvStageId[] {
  if (ctx.running) return ["scanning"];
  const stages: TvStageId[] = [];
  if (ctx.triage > 0) stages.push("decide");
  stages.push("standing");
  if (ctx.inFlight > 0) stages.push("inflight");
  return stages;
}

/** Clamp a rotation index onto the current stage list (the list shrinks/grows as state changes). */
export function clampStageIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}
