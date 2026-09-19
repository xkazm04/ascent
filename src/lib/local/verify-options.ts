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
 *   • `verified`              — the repository's own command passed in the lane's worktree before the
 *                               session and passed again after it.
 *   • `rejected`              — it PASSED before and FAILED after. The agent's edits are discarded in
 *                               the throwaway worktree, nothing is committed, nothing is delivered,
 *                               and the lane ends with no claim. The one verdict that changes what
 *                               the lane does.
 *   • `baseline-unavailable`  — the command did not pass on the PRISTINE lane worktree, so there is
 *                               no baseline to compare the session against. No blame, no rejection:
 *                               the lane proceeds exactly as it would have without a guard.
 *
 *                               READ THE NAME LITERALLY. It says the guard could not establish a
 *                               baseline HERE — it does NOT say the repository's checks are failing.
 *                               A worktree carries tracked files plus the dependency caches the loop
 *                               links, and nothing else: gitignored local state (credentials, `.env`,
 *                               service config, a `.venv`) is correctly absent. Measured on
 *                               `xkazm04/systedo-case` (2026-08-31): the suite passes 3744/3744 in
 *                               the paired checkout and fails 8 in a worktree cut from the same
 *                               commit — every failure a missing Google application-default
 *                               credential. The old name for this verdict was `baseline-red`, and the
 *                               loop spent fourteen lanes ordering agents to "repair" a green suite.
 *   • `skipped`               — no command could be resolved, or the operator turned the guard off.
 *                               Recorded with its reason, because an unverified lane must never read
 *                               as a verified one.
 */
export type VerifyVerdict = "verified" | "rejected" | "baseline-unavailable" | "skipped";

/**
 * WHICH COMMAND A VERDICT IS ABOUT — the rung of the narrowing ladder the guard actually ran.
 *
 * A git worktree is not a runnable environment for a realistic application. It carries tracked files
 * plus the dependency caches the loop links and NONE of the gitignored credentials, service config or
 * local databases a full suite reaches for. Measured 2026-08-31: `xkazm04/systedo-case` passes
 * 3744/3744 in the paired checkout and fails 8 in a worktree cut from the same commit, every failure
 * a missing Google application-default credential; `xkazm04/kp` fails 2. So on exactly the two
 * repositories the guard was built for, the primary command could never establish a baseline — the
 * guard protected nothing, and (because unverified work must not be delivered) it also blocked every
 * delivery.
 *
 * A WEAKER GUARD IS STILL A GUARD. Typechecking and linting are hermetic: no credentials, no
 * services, nothing a worktree lacks. A structural refactor that breaks the build or the types is
 * also the damage most worth catching. So when the primary cannot establish a baseline the guard
 * NARROWS — `typecheck`, then `lint` — and takes the first rung that passes on the pristine tree.
 *
 * THE RUNG IS PERSISTED AND PRINTED EVERYWHERE A HUMAN READS A VERDICT, because a lane verified
 * against `npm run typecheck` has NOT been verified against the repository's tests and a reader must
 * never believe otherwise.
 */
export type VerifyRung = "primary" | "typecheck" | "lint";

export const VERIFY_RUNGS: readonly VerifyRung[] = ["primary", "typecheck", "lint"];

/** A rung from an untrusted column, else `null` — "we do not know which command this verdict is
 *  about", which is what every lane written before the ladder carries. Null is NOT `primary`: a
 *  guess in that direction would silently upgrade an unknown verdict into a full one. */
export const asVerifyRung = (v: unknown): VerifyRung | null =>
  typeof v === "string" && (VERIFY_RUNGS as readonly string[]).includes(v) ? (v as VerifyRung) : null;

/** Was this verdict reached against a NARROWED fallback rather than the repository's own gate? */
export const isNarrowedRung = (v: unknown): boolean => {
  const r = asVerifyRung(v);
  return r != null && r !== "primary";
};

/** The short word a sheet or rail prints beside `verified` when the ladder narrowed — `typecheck
 *  only`, `lint only` — and `null` when it did not, because "primary" is the normal case and a badge
 *  meaning "normal" is noise. */
export const narrowedRungTag = (v: unknown): string | null => (isNarrowedRung(v) ? `${asVerifyRung(v)} only` : null);

export const VERIFY_VERDICTS: readonly VerifyVerdict[] = ["verified", "rejected", "baseline-unavailable", "skipped"];

/**
 * WORDS ALREADY WRITTEN TO THE COLUMN, mapped onto the vocabulary above.
 *
 * `verifyVerdict` is a TEXT column and every lane run before 2026-08-31 carries `baseline-red`. The
 * widening discipline this codebase keeps for JSON-in-TEXT applies to a plain enum column just as
 * well: WIDEN THE READER, never rewrite the history. So the old word still parses — into the new
 * meaning, which is the meaning it always had and only the name got wrong.
 */
const LEGACY_VERDICTS: Readonly<Record<string, VerifyVerdict>> = { "baseline-red": "baseline-unavailable" };

/** A verdict from an untrusted column, else `null` — "this lane has no verdict", which is what every
 *  lane written before the guard existed genuinely has and is NOT the same as `skipped`. */
export const asVerifyVerdict = (v: unknown): VerifyVerdict | null =>
  typeof v === "string"
    ? (VERIFY_VERDICTS as readonly string[]).includes(v)
      ? (v as VerifyVerdict)
      : (LEGACY_VERDICTS[v] ?? null)
    : null;

/** The one word a lane's row prints. `null` renders nothing — a lane from before the guard is not a
 *  lane that was skipped, and a tag on it would be a claim about a run nobody made. Same rule
 *  `deliveryTag`, `laneKindTag` and `laneExecutorTag` follow.
 *
 *  `no baseline` and not `baseline red`: the badge is read at a glance and out of context, and the
 *  old word was routinely read as "this repository is red". It is not a claim about the repository. */
export const verifyVerdictTag = (v: string | null | undefined): string | null => {
  switch (asVerifyVerdict(v)) {
    case "verified":
      return "verified";
    case "rejected":
      return "rejected";
    case "baseline-unavailable":
      return "no baseline";
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
 * A NARROWED `verified` IS DELIVERABLE, deliberately. The verdict does not carry the rung here and is
 * not meant to: the alternative — refusing every lane whose repository keeps credentials in its test
 * suite — is the situation the ladder exists to end, and it is the situation that held on both
 * campaign repositories. The trade is stated rather than hidden: a narrowed lane is delivered on a
 * proof that it still COMPILES and LINTS, not that the suite is green, and every surface that renders
 * the verdict says which command it was (`narrowedRungTag`).
 *
 * `null` for `verified` and ONLY for `verified`. That is the whole rule: turning the guard on is a
 * request that changes be CHECKED before they reach a branch, and three of the four verdicts —
 * plus the absent one — mean the check was never made. "We could not check" is not permission to
 * land, and a run that lands on it inverts the operator's own instruction. (Run a97baf88, 2026-08-30:
 * every cycle on both repos returned `baseline-unavailable`, so nothing was ever verified, and every
 * lane landed into the operator's working branch anyway because only `rejected` was refused.)
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
    case "baseline-unavailable":
      return "the guard could not establish a baseline in the lane's worktree — the repository's own check did not pass there before the agent's session, so nothing this cycle produced could be verified (that is a fact about the worktree, not evidence the repository's checks fail)";
    case "skipped":
      return "verification was skipped — no command could be resolved for this repository, so this cycle was never checked";
    default:
      return "this lane recorded no verification verdict at all, so nothing confirms its work was checked";
  }
}
