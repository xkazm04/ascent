// WHAT THE DEGRADATION GUARD CONCLUDED — the verdict vocabulary, as a value both the browser and the
// server can hold.
//
// This module is deliberately DEPENDENCY-FREE (no `process`, no `node:*`, no readers), for the same
// reason `agent-options.ts`, `delivery-options.ts` and `run-limits.ts` are — and here it is load-
// bearing twice over:
//
//   1. ONE LIST. The word a lane row prints and the word the engine wrote have to be the same word,
//      and the way that stops being true is two declarations.
//   2. THE CLIENT/SERVER BOUNDARY. `lane-verify.ts` — where the RESOLUTION lives — reaches for
//      `readManifestYaml` and `parseCommands`, which pull the analyzer graph in behind them. The
//      cockpit's lane rail needs the verdict's *word* and nothing else, and importing it from there
//      would drag the whole scoring pipeline into the browser bundle. `tsc` and the unit suite both
//      pass on that mistake; only `next build` catches it (see docs: "build not in the gate").
//
// The RESOLUTION and the RUNNING live in `lane-verify.ts` / `lane-guard.ts`, which re-export these so
// a server caller still has one import.

/**
 * What the guard concluded about one lane.
 *
 *   • `verified`     — the repository's own command passed before the session and passed after it.
 *   • `rejected`     — it PASSED before and FAILED after. The agent's edits are discarded in the
 *                      throwaway worktree, nothing is committed, nothing is delivered, and the lane
 *                      ends with no claim. The one verdict that changes what the lane does.
 *   • `baseline-red` — it FAILED before the session too. The repository was already red and this is
 *                      NOT the agent's doing: no blame, no rejection, the lane proceeds exactly as it
 *                      would have without a guard. A guard that punished an agent for arriving at a
 *                      broken repository would make the loop unusable on precisely the repositories
 *                      that need it most.
 *   • `skipped`      — no command could be resolved, or the operator turned the guard off. Recorded
 *                      with its reason, because an unverified lane must never read as a verified one.
 */
export type VerifyVerdict = "verified" | "rejected" | "baseline-red" | "skipped";

export const VERIFY_VERDICTS: readonly VerifyVerdict[] = ["verified", "rejected", "baseline-red", "skipped"];

/** A verdict from an untrusted column, else `null` — "this lane has no verdict", which is what every
 *  lane written before the guard existed genuinely has and is NOT the same as `skipped`. */
export const asVerifyVerdict = (v: unknown): VerifyVerdict | null =>
  typeof v === "string" && (VERIFY_VERDICTS as readonly string[]).includes(v) ? (v as VerifyVerdict) : null;

/** The one word a lane's row prints. `null` renders nothing — a lane from before the guard is not a
 *  lane that was skipped, and a tag on it would be a claim about a run nobody made. Same rule
 *  `deliveryTag`, `laneKindTag` and `laneExecutorTag` follow. */
export const verifyVerdictTag = (v: string | null | undefined): string | null => {
  switch (asVerifyVerdict(v)) {
    case "verified":
      return "verified";
    case "rejected":
      return "rejected";
    case "baseline-red":
      return "baseline red";
    case "skipped":
      return "unverified";
    default:
      return null;
  }
};

/**
 * WHY THIS LANE MAY NOT BE DELIVERED WHEN THE OPERATOR ASKED FOR VERIFICATION — one sentence, shared
 * by both delivery doors (the unattended step in `loop-delivery.ts` and the one-click
 * `POST /api/org/loop/[id]/pr`), so they can never give the same lane two different answers.
 *
 * `null` for `verified` and ONLY for `verified`. That is the whole rule: turning the guard on is a
 * request that changes be CHECKED before they reach a branch, and three of the four verdicts —
 * plus the absent one — mean the check was never made. "We could not check" is not permission to
 * land, and a run that lands on it inverts the operator's own instruction. (Run a97baf88, 2026-08-30:
 * every cycle on both repos returned `baseline-red`, so nothing was ever verified, and every lane
 * landed into the operator's working branch anyway because only `rejected` was refused.)
 *
 * The sentences are BRANCH-FREE and RUN-FREE on purpose: they are also the content of the standing
 * lesson row, which is keyed one-per-cause rather than one-per-run.
 */
export function unverifiedDeliveryReason(v: string | null | undefined): string | null {
  switch (asVerifyVerdict(v)) {
    case "verified":
      return null;
    case "rejected":
      return "the degradation guard rejected this cycle — the repository's own check passed before the agent's session and failed after it";
    case "baseline-red":
      return "the repository's own check was already failing before the agent's session (baseline red), so nothing this cycle produced could be verified";
    case "skipped":
      return "verification was skipped — no command could be resolved for this repository, so this cycle was never checked";
    default:
      return "this lane recorded no verification verdict at all, so nothing confirms its work was checked";
  }
}
