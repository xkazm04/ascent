// THE BOOT SWEEP — the one thing a fresh process knows that no request handler does: nothing this
// process started is in flight, so every `running` loop run and every `running` drive in the database
// belongs to a process that is gone.
//
// Before this existed the reconcile ran only on the first `GET /api/org/loop` and inside
// `startLoopRun`, so a crashed run read as `running` until somebody opened the tab — and the backlog
// rows its lanes had claimed stayed `in_progress` for exactly as long (the zombie-claim failure that
// made drive #2 find "no open follow-ups" on a fleet with 350 points of debt). A digest, a direct DB
// reader, or simply nobody opening the tab all saw a lie.
//
// SANCTIONED PLACE: `src/instrumentation.ts`'s `register()`, Next's startup hook — the same door the
// embedded PGlite boots from, and it runs before the first request. Called with no `isLive` predicate
// on purpose: that default ("nothing is live") is WRONG for every request path and exactly right here.
//
// THE STANDING RUNNER IS THE ONE EXCEPTION TO "RECONCILE, NEVER RESUME" (spark theater-upgrade,
// 2026-09-18, operator decision). A continuous drive whose row still says running / paused / idle is
// RE-ATTACHED on its SAME row — the runner exists to run until the operator stops it, and a restart is
// not the operator. Two guards keep that from being a boot that spends money on its own: it happens
// only on a self-hosted deployment (below) AND only while the loop is enabled (`autopilotEnabled()`);
// with the loop off, the runner is marked `interrupted` with that reason instead. A BOUNDED drive is
// untouched by this: it is still interrupted, and resuming it is still a human's click.
//
// SELF-HOSTED ONLY, and that guard is load-bearing rather than cosmetic. The loop and the drive exist
// only on a self-hosted deployment (they read the server's filesystem and spawn processes), so on
// managed cloud there is nothing to reconcile — and a managed deployment can run many instances, where
// "this process started nothing" would be a claim about one instance applied to every other one's
// live work.

import { tmpdir } from "node:os";
import { selfHosted } from "@/lib/env";
import { isDbConfigured } from "@/lib/db";
import { listInFlightLanes, markStaleRunsStopped } from "@/lib/db/loop-runs";
import {
  DRIVE_INTERRUPTED_REASON,
  RUNNER_AUTOPILOT_OFF_REASON,
  listRunnerDrivesToResume,
  markDriveInterrupted,
  markStaleDrivesInterrupted,
} from "@/lib/db/drives";
import { getRepoLocalPath } from "@/lib/db/org-local";
import { removeStrandedWorktrees } from "@/lib/local/loop-worktree";

export interface BootSweepResult {
  /** Skipped without looking: not self-hosted, or no database configured. */
  skipped: boolean;
  runs: number;
  drives: number;
  /** Temp checkouts the stopped runs stranded on disk (L2-C-02). */
  worktrees: number;
  /** Standing runners re-attached on their same rows. */
  resumed: number;
}

const DONE_KEY = "__ascentBootSweepDone" as const;

/**
 * Reconcile the work a dead process left behind. Runs first, then drives: `markStaleRunsStopped` is
 * what releases the backlog claims of a run's in-flight lanes, and a drive's own row owns no claims —
 * so sweeping runs first means a drive is never marked interrupted while its last run still looks
 * alive.
 *
 * Idempotent per process (a second call is a no-op) so a dev-server hot reload that re-enters
 * `register()` cannot sweep twice.
 */
export async function sweepInterruptedWork(): Promise<BootSweepResult> {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[DONE_KEY]) return { skipped: true, runs: 0, drives: 0, worktrees: 0, resumed: 0 };
  g[DONE_KEY] = true;

  if (!selfHosted() || !isDbConfigured()) return { skipped: true, runs: 0, drives: 0, worktrees: 0, resumed: 0 };
  // READ BEFORE THE SWEEP. `markStaleRunsStopped` is what makes these runs stopped, so the set of
  // lanes it is about to reconcile can only be read while they still say `running` — afterwards a
  // lane this process interrupted is indistinguishable from one that errored a week ago, and the
  // filesystem half would be deleting worktrees it never stopped. This is also the whole of the
  // "never touch a live run's worktree" guarantee: a fresh process drives nothing, so every lane in
  // this read belongs to a dead one.
  const inFlight = await listInFlightLanes().catch(() => []);
  const runs = await markStaleRunsStopped().catch(() => 0);
  // THE RUNNERS, read AFTER the runs are reconciled (their in-flight run is now `stopped`, so the org's
  // one run slot is free again) and BEFORE the drive sweep, which must spare the ones re-attached.
  const runners = await listRunnerDrivesToResume().catch(() => []);
  const attach = runners.length > 0 && (await loopEnabled());
  let refused = 0;
  if (!attach) {
    for (const r of runners) if (await markDriveInterrupted(r.drive.id, RUNNER_AUTOPILOT_OFF_REASON).catch(() => false)) refused += 1;
  }
  const spared = new Set(attach ? runners.map((r) => r.drive.id) : []);
  const drives = (await markStaleDrivesInterrupted(undefined, (id) => spared.has(id)).catch(() => 0)) + refused;
  // The filesystem half of the reconcile. `removeLoopWorktree` runs in the lane's `finally`, which a
  // hard kill never reaches, so every `taskkill /F` leaves a ~15 MB checkout in %TEMP% forever
  // (L2-C-02: 3 from the L2 run, 4 more already on the operator's machine from three days before).
  const worktrees =
    inFlight.length > 0
      ? (
          await removeStrandedWorktrees(inFlight, { pairedPath: getRepoLocalPath, tempRoot: tmpdir }).catch(
            () => [] as string[],
          )
        ).length
      : 0;
  // Re-attached LAST, after the filesystem half: a runner's first step opens worktrees of its own, and
  // the stranded-worktree sweep should be done with the repos before it does.
  const resumed = attach ? await reattachRunners(runners) : [];
  // A runner spared above but NOT re-attached (the engine could not load) would read `running` with no
  // process behind it — the lie this sweep exists to end. It is interrupted after all.
  let lost = 0;
  for (const id of spared) {
    if (!resumed.includes(id) && (await markDriveInterrupted(id, DRIVE_INTERRUPTED_REASON).catch(() => false))) lost += 1;
  }
  return { skipped: false, runs, drives: drives + lost, worktrees, resumed: resumed.length };
}

/** The loop's own opt-in, read lazily: `agent.ts` is only loaded when there is a runner to judge. */
async function loopEnabled(): Promise<boolean> {
  try {
    const { autopilotEnabled } = await import("@/lib/local/agent");
    return autopilotEnabled();
  } catch {
    return false;
  }
}

/** Dynamic for the same reason: the engine graph loads only when a runner is actually re-attached. */
async function reattachRunners(rows: Awaited<ReturnType<typeof listRunnerDrivesToResume>>): Promise<string[]> {
  try {
    const { resumeRunnerDrives } = await import("@/lib/local/runner-control");
    return resumeRunnerDrives(rows);
  } catch {
    return [];
  }
}

/** The line the boot sweep prints when it actually reconciled something. Silent otherwise — a clean
 *  boot has nothing to say, and a log line every start would train the operator to ignore it. */
export function bootSweepLine(r: BootSweepResult): string | null {
  if (r.skipped || (r.runs === 0 && r.drives === 0 && r.worktrees === 0 && !r.resumed)) return null;
  const parts: string[] = [];
  if (r.runs > 0) parts.push(`${r.runs} loop ${r.runs === 1 ? "run" : "runs"} stopped`);
  if (r.drives > 0) parts.push(`${r.drives} ${r.drives === 1 ? "drive" : "drives"} marked interrupted`);
  if (r.worktrees > 0) parts.push(`${r.worktrees} stranded ${r.worktrees === 1 ? "worktree" : "worktrees"} removed`);
  if (r.resumed) parts.push(`${r.resumed} standing ${r.resumed === 1 ? "runner" : "runners"} resumed`);
  return `[loop] boot sweep: ${parts.join(", ")} — a previous process died while they were in flight.`;
}
