// THE INTEGRITY GUARD — a lane may not edit the surface that scores it.
//
// Every measurement elsewhere in this system assumes the instrument is read-only to the thing being
// measured. An agent candidate voids that assumption in a way no previous system under test did,
// because it holds the same shell the harness holds: it can read the verify command, edit a test,
// relax a fixture, and then score a clean lift for having done nothing. The prohibition ("do not
// weaken the tests") does not work and cannot, because it is unfalsifiable at the only place it would
// have to be checked — inside a loop nobody is reading — and this loop is explicitly unattended.
//
// So the corrective is structural: before a lift is credited, diff the lane's own commits against the
// scoring surface. A lane that touched it is recorded VOID WITH ITS REASON and excluded from the
// metric, and the void is REPORTED AS AN OUTCOME rather than dropped — a silently discarded void lane
// flatters the arm that produced it, which is the failure this guard exists to prevent.
//
// This extends the shape `checkPlanFence` already established (pure git-diff analysis over a lane's
// commits) rather than inventing a second mechanism.
//
// STUB — WP5 implements. Signatures are final.

/** Why a lane was voided. Printed verbatim in the ledger beside the lane. */
export interface VoidVerdict {
  void: boolean;
  /** Null when not void. */
  reason: string | null;
  /** The paths that triggered it, bounded for display. Empty when not void. */
  paths: string[];
}

/**
 * The classes of file whose change can flatter a verdict.
 *
 * Deliberately a classifier rather than a path list: a repo's test layout is its own, and a list
 * maintained here is a list that goes stale the first time a directory is renamed — which would turn
 * the guard off silently, in a voice indistinguishable from "nothing was touched".
 */
export type ScoringSurface = "verify-command" | "test-file" | "fixture" | "gate-config";

export function classifyScoringSurface(_path: string): ScoringSurface | null {
  return null;
}

/** Judge one lane's committed paths. A lane with no commits is not void — it simply never rescans. */
export function checkGateDiff(_changedPaths: string[]): VoidVerdict {
  return { void: false, reason: null, paths: [] };
}
