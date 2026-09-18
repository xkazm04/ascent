// THE ONE PHASE VOCABULARY every surface maps from (spark theater-upgrade, 2026-09-18; WP4 implements).
//
// Derived — never stored — from the lane's persisted phase/stage plus its recent activity
// (`streaming-output/phase-derivation`): a Read/Grep/Glob tail reads as `agent-reading`, an Edit/Write as
// `agent-editing`, assistant text as `agent-thinking`; a SPECIFIC agent phase whose newest evidence is
// older than `PHASE_QUIET_MS` decays to `agent-quiet` ("still working, quiet for Nm"), never freezes.
// Presentation only: program logic branches on typed lane state, never on this label.
//
// DEPENDENCY-FREE: the pulse read computes it on the server and the theater may recompute it in the
// browser against its own clock.

import type { LaneActivity, LanePhase } from "@/lib/local/runner-types";

export interface PhaseInput {
  /** `LoopRunLane.phase` — queued | dispatching | rescanning | done | error. */
  phase: string;
  /** `LoopRunLane.stage` — planning | verifying | installing | fetch … compose | null. */
  stage: string | null;
  tail: readonly LaneActivity[];
  heartbeatAt: string | null;
  /** True when the lane's delivery was held (fence, install). */
  held?: boolean;
}

/** STUB (WP0): the coarse mapping the rail used before a vocabulary existed. */
export function deriveLanePhase(input: PhaseInput, _now: number): LanePhase {
  if (input.held) return "held";
  if (input.phase === "queued") return "queued";
  if (input.phase === "rescanning") return "rescanning";
  if (input.phase === "done") return "done";
  if (input.phase === "error") return "error";
  if (input.stage === "planning") return "planning";
  if (input.stage === "verifying") return "verifying";
  return "agent-thinking";
}

/** The words a surface prints for a phase. STUB (WP0): the token itself. */
export function lanePhaseLabel(phase: LanePhase, _quietForMs: number | null = null): string {
  return phase;
}
