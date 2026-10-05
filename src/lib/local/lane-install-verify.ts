// THE DEGRADATION GUARD FOR AN INSTALL LANE, and the diff it judges.
//
// An install lane (`foundation` / `practice`) writes generated files and COMMITS them itself, so it
// used to bypass the guard entirely and record no verdict — which the runner reads as "never checked"
// and therefore never lands (`unverifiedDeliveryReason`). Every round then re-installed the same
// starter from the same base. These two halves give it the same A/B the agent lane gets: baseline
// BEFORE the install, result after it, the verdict persisted in the same columns.
//
// THE ONE DIFFERENCE IS THE REVERSAL. The guard's discard cleans a DIRTY tree; an install is already a
// commit, so a rejection also resets the lane's own isolated worktree back to the sha the lane started
// on — exactly what the agent lane does for adopted commits. Never a paired checkout: `dir` is the
// throwaway worktree `createLoopWorktree` made (see the header of `lane-guard.ts`).

import type { GitResult } from "@/lib/local/git";
import { appendLaneLog, updateLane } from "@/lib/db/loop-runs";
import { recordLoopLessons } from "@/lib/db/loop-lessons";
import {
  NO_VERIFY_BASELINE,
  verifyBaseline,
  verifyRejectionLesson,
  verifyResult,
  type GuardOutcome,
  type VerifyBaseline,
} from "@/lib/local/lane-guard";
import { LANE_REPORT_PATH } from "@/lib/local/lane-report";
import type { LaneWatchdog } from "@/lib/local/lane-watchdog";

type Git = (args: readonly string[]) => Promise<GitResult>;

/** What a lane writes when the operator switched the guard off — `skipped` WITH its reason, never
 *  null: null is what a lane written before the guard existed carries, and "we did not check" must
 *  not masquerade as "there was nothing to check". One copy, for both lane kinds. */
export const GUARD_OFF_PATCH = {
  verifyVerdict: "skipped",
  verifyCommand: null,
  verifyRung: null,
  verifyNote: "Verification SKIPPED: the degradation guard was switched off for this run. This lane's work is UNVERIFIED.",
} as const;

const splitZ = (out: string): string[] => out.split("\0").map((p) => p.trim()).filter(Boolean);

/**
 * Every path this lane changed relative to the sha it started on: committed since `before` (adopted
 * commits) plus uncommitted — tracked edits and untracked files the repo does not ignore. `undefined`
 * when git could not say, which the guard reads as "no diff known" (its pre-inertness behaviour).
 *
 * `--no-renames` because a rename reports only its destination: `build.sh` → `docs/build.md` would
 * otherwise read as one inert file. `-z` because a quoted non-ASCII path is not a path. The lane's own
 * report is dropped — it is a channel to Ascent, kept out of the deliverable (`excludeLaneReport`).
 */
export async function laneChangedPaths(git: Git, before: string): Promise<string[] | undefined> {
  if (!before) return undefined;
  const tracked = await git(["diff", "--name-only", "--no-renames", "-z", before]);
  const untracked = await git(["ls-files", "--others", "--exclude-standard", "-z"]);
  if (!tracked.ok || !untracked.ok) return undefined;
  const paths = [...splitZ(tracked.stdout), ...splitZ(untracked.stdout)].filter((p) => p !== LANE_REPORT_PATH);
  return [...new Set(paths)];
}

interface InstallGuardIo {
  laneId: string;
  dir: string;
  verifyMs: number;
  stage: LaneWatchdog["stage"];
}

/** A — the pristine baseline, measured BEFORE the install writes anything (cached per worktree). */
export async function installBaseline(io: InstallGuardIo): Promise<VerifyBaseline> {
  await updateLane(io.laneId, { stage: "baseline" });
  // The `.catch` sits INSIDE the raced work, as in the agent branch: a failing guard is baseline data,
  // a guard that never returns is the watchdog's to cut.
  const baseline = await io.stage("baseline", () => verifyBaseline(io.dir, io.verifyMs).catch(() => NO_VERIFY_BASELINE));
  await updateLane(io.laneId, { stage: null });
  return baseline;
}

/**
 * B — judge a COMMITTED install and persist the verdict exactly as the agent branch does. The written
 * paths go to the guard, so an install of documentation alone on a repository with no runnable check
 * is verified by construction (`lane-inert.ts`). On `reject` the install commit has already been taken
 * back off the lane branch, the lesson and the reversal deliverable recorded; the caller exits.
 */
export async function verifyInstall(
  io: InstallGuardIo & {
    baseline: VerifyBaseline;
    written: readonly string[];
    before: string;
    branch: string;
    org: string;
    repo: string;
    git: Git;
  },
): Promise<GuardOutcome> {
  await updateLane(io.laneId, { stage: "verifying" });
  const outcome = await io.stage("verify", () => verifyResult(io.dir, io.baseline, io.verifyMs, undefined, io.written, { allAdded: true }));
  await updateLane(io.laneId, {
    stage: null,
    verifyVerdict: outcome.verdict,
    verifyCommand: outcome.command,
    verifyNote: outcome.note,
    verifyRung: outcome.rung,
  });
  await appendLaneLog(io.laneId, outcome.note);
  if (!outcome.reject) return outcome;
  await recordLoopLessons(io.org, io.repo, io.laneId, [verifyRejectionLesson(io.repo, outcome)]).catch(() => []);
  const back = await io.git(["reset", "--hard", io.before]);
  await appendLaneLog(
    io.laneId,
    back.ok
      ? `The install commit was taken back off ${io.branch}: it broke a check that passed before it.`
      : `The install commit could NOT be taken back off ${io.branch} (${back.stderr.split("\n")[0] ?? ""}). Check the worktree.`,
  );
  // Covers nothing, like the agent branch's: no follow-up was closed by a reversed install.
  await updateLane(io.laneId, {
    deliverables: [{ headline: "Discarded — repository checks regressed", dimId: null, kind: "noted", covers: [], evidence: outcome.note }],
  });
  return outcome;
}
