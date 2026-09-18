// THE STANDING RUNNER'S CONTROL SURFACE — the production wiring of `runContinuous`, and the handful of
// verbs that act on a live runner (spark theater-upgrade, 2026-09-18; WP2).
//
//   launchRunner        register a continuous drive in the process registry and pull it
//   resumeRunnerDrives  the BOOT SWEEP's re-attach: a continuous drive whose row still says running /
//                       paused / idle is resumed on the SAME row (operator decision) — never a new drive
//   resumeRunnerRepo    the operator lifts one repo's pause (`POST …/drive {action:"resume-repo"}`)
//   runnerBaseFor       which branch a repo's runner merges back into (the merge-out route)
//   noteRunnerAhead     the merge-out moved the base, so the runner's "ahead" count is refreshed
//
// Kept apart from `drive.ts` so the boot sweep can import the re-attach without the bounded driver,
// and the driver loop (`runner.ts`) stays free of every real seam.

import { startLoopRun, stopLoopRun } from "@/lib/local/loop-engine";
import { getLoopRun, listLanes } from "@/lib/db/loop-runs";
import { getRepoLocalPath } from "@/lib/db/org-local";
import { listDriveRows, saveDriveRow } from "@/lib/db/drives";
import { orgLaneSpendSince } from "@/lib/db/runner-spend";
import { ensureRunnerBranch, mergeInBase, resolveBaseBranch, runnerAheadCount, runnerTip } from "@/lib/local/runner-branch";
import { measureDrive } from "@/lib/local/drive-measure";
import { drives, liveDriveFor } from "@/lib/local/drive-registry";
import { runContinuous, type RunnerDeps } from "@/lib/local/runner";
import { liftRepoPause } from "@/lib/local/runner-policy";
import type { DriveEventRecord, DriveStatus } from "@/lib/local/drive-types";

export const defaultRunnerDeps: RunnerDeps = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  save: saveDriveRow,
  measure: measureDrive,
  spendSince: orgLaneSpendSince,
  pairedPath: getRepoLocalPath,
  resolveBase: resolveBaseBranch,
  ensureBranch: ensureRunnerBranch,
  mergeIn: mergeInBase,
  aheadCount: runnerAheadCount,
  runnerTip,
  startRun: startLoopRun,
  runEnded: async (runId) => {
    const run = await getLoopRun(runId);
    return run == null || run.endedAt != null;
  },
  stopRun: (runId) => stopLoopRun(runId),
  listLanes,
};

const nowIso = (): string => new Date().toISOString();

function pushEvent(st: DriveStatus, e: DriveEventRecord): void {
  (st.events ??= []).push(e);
}

/** Pull a continuous drive in this process. A throw ends it in `error` with the reason, exactly as a
 *  bounded drive's does. */
export function launchRunner(st: DriveStatus, actor: string | null, deps: RunnerDeps = defaultRunnerDeps): void {
  drives.set(st.id, st);
  void runContinuous(st, actor, deps).catch(async (err: unknown) => {
    st.phase = "error";
    st.error = err instanceof Error ? err.message : String(err);
    st.endedAt = deps.now().toISOString();
    await deps.save(st);
  });
}

/**
 * RE-ATTACH the standing runners a restart orphaned — on their SAME rows. The run the restart killed
 * was already reconciled `stopped` by the sweep (runs go first), so its ledger entry is closed here with
 * a note; the event "resumed after restart" is the ledger's record of the gap. A stop that was
 * requested before the crash is honoured on the first iteration — the runner ends `stopped`.
 *
 * @returns the ids this process now pulls (one it already pulled — a hot reload — is not re-launched).
 */
export function resumeRunnerDrives(
  rows: readonly { drive: DriveStatus; createdBy: string | null }[],
  deps: RunnerDeps = defaultRunnerDeps,
): string[] {
  const resumed: string[] = [];
  const at = deps.now().toISOString();
  for (const { drive: st, createdBy } of rows) {
    if (st.mode !== "continuous") continue;
    if (drives.has(st.id)) {
      resumed.push(st.id);
      continue;
    }
    for (const run of st.runs) {
      if (run.endedAt != null) continue;
      run.endedAt = at;
      run.note = "Interrupted by a server restart; the run was reconciled as stopped.";
    }
    pushEvent(st, { event: "restart-resumed", at, repo: null, reason: null, until: null, note: "Resumed after restart — the runner re-attached on the same row." });
    launchRunner(st, createdBy, deps);
    resumed.push(st.id);
  }
  return resumed;
}

export type ResumeRepoResult = { ok: true; drive: DriveStatus } | { ok: false; status: 404 | 409; error: string };

/** The operator lifts one repo's pause on the org's live runner. */
export async function resumeRunnerRepo(org: string, repo: string): Promise<ResumeRepoResult> {
  const st = liveDriveFor(org);
  if (!st || st.mode !== "continuous") return { ok: false, status: 404, error: "No standing runner is live for this organization." };
  const s = (st.repoState ?? []).find((r) => r.repo === repo);
  if (!s) return { ok: false, status: 404, error: `${repo} is not in the runner's scope.` };
  const was = s.paused;
  if (!liftRepoPause(s)) return { ok: false, status: 409, error: `${repo} is not paused.` };
  pushEvent(st, { event: "repo-resumed", at: nowIso(), repo, reason: was, until: null, note: `The operator resumed ${repo} (it was paused: ${was}).` });
  await saveDriveRow(st);
  return { ok: true, drive: st };
}

/** The branch a repo's runner merges back into: the live runner's record, else the newest continuous
 *  drive's, else null (the caller resolves it from the checkout). */
export async function runnerBaseFor(org: string, repo: string): Promise<string | null> {
  const live = liveDriveFor(org);
  const fromLive = live?.repoState?.find((r) => r.repo === repo)?.baseBranch;
  if (fromLive) return fromLive;
  const rows = await listDriveRows(org).catch(() => [] as DriveStatus[]);
  for (const d of rows) {
    if (d.mode !== "continuous") continue;
    const base = d.repoState?.find((r) => r.repo === repo)?.baseBranch;
    if (base) return base;
  }
  return null;
}

/** After a merge-out, the live runner's "ahead of base" for that repo is stale — refresh it. */
export async function noteRunnerAhead(org: string, repo: string, ahead: number | null): Promise<void> {
  const live = liveDriveFor(org);
  const s = live?.repoState?.find((r) => r.repo === repo);
  if (!live || !s) return;
  s.aheadOfBase = ahead;
  await saveDriveRow(live);
}
