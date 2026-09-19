// LOCAL MODE autopilot — now a THIN SHIM over the loop engine (src/lib/local/loop-engine.ts).
//
// The autopilot was the first shape of this idea: one org, one repo, one branch, cycles of
// "pick the top open follow-ups → dispatch a local agent in an isolated worktree → rescan from disk
// so the `Ascent-Resolves:` trailers close their rows". The loop engine is that same machine with
// the arity widened (a selected SET of repos, worked as bounded-parallel lanes) and the state moved
// into the database. Keeping a second copy of the mechanics here would guarantee the two drift, so
// this module now only TRANSLATES: a single-repo loop run, projected back into the `AutopilotJob`
// shape `/api/org/local/autopilot` has always answered with.
//
// Two things are preserved deliberately, because the route's contract is observable:
//   • The job shape (phase / cycle / log / closedIds / commits / branch) is byte-for-byte the same.
//   • The branch name stays `ascent/autopilot-<stamp>` rather than the loop engine's
//     `ascent/loop-<stamp>-<repo>` — an operator's existing "review the autopilot branch" habit (and
//     any local tooling keyed on the prefix) must not break just because the plumbing moved.
//
// The accessors are ASYNC now, since the truth lives in the DB rather than a process Map. That is
// the one signature change, and the route awaits them.
//
// AutopilotJob is a ONE-REPO row (one `repo`, one branch). A multi-repo loop run has no faithful
// projection onto that shape — naming `repos[0]` and flattening every lane's log would tell the
// band the wrong repo is being worked. Multi-repo runs stay on the cockpit; this shim ignores them.

import { LOOP_MAX_CYCLES_CAP, getActiveLoopRun, listLanes, listLoopRuns, getLoopRun, markStaleRunsStopped, type LoopLaneRecord, type LoopRunRecord } from "@/lib/db/loop-runs";
import { isLoopRunLive, startLoopRun, stopLoopRun } from "@/lib/local/loop-engine";
import type { LaneDeps } from "@/lib/local/loop-lane";

export const MAX_CYCLES_CAP = LOOP_MAX_CYCLES_CAP;

export type AutopilotPhase = "starting" | "dispatching" | "rescanning" | "done" | "stopped" | "error";

export interface AutopilotJob {
  org: string;
  repo: string;
  branch: string | null;
  phase: AutopilotPhase;
  cycle: number;
  maxCycles: number;
  startedAt: string;
  endedAt: string | null;
  /** Rolling human-readable log, newest last (bounded). */
  log: string[];
  closedIds: string[];
  commits: number;
  error: string | null;
  /** Cooperative stop flag — checked between phases, never mid-agent-session. */
  stopRequested: boolean;
}

/** A run the legacy job shape can name without lying. AutopilotJob has one `repo`. */
function isSingleRepoRun(run: { readonly repos: readonly string[] }): boolean {
  return run.repos.length === 1;
}

/** Project a single-repo run + its lanes back into the legacy job shape. Pure; exported for tests.
 *  Multi-repo runs return null — the cockpit owns that surface, not `/api/org/local/autopilot`. */
export function toAutopilotJob(org: string, run: LoopRunRecord, lanes: readonly LoopLaneRecord[]): AutopilotJob | null {
  if (!isSingleRepoRun(run)) return null;
  const ordered = [...lanes].sort((a, b) => a.cycle - b.cycle);
  const last = ordered[ordered.length - 1];
  return {
    org,
    repo: run.repos[0] ?? last?.repoFullName ?? "",
    branch: [...ordered].reverse().find((l) => l.branch)?.branch ?? null,
    phase: projectPhase(run, last),
    cycle: run.cycle,
    maxCycles: run.maxCycles,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    log: ordered.flatMap((l) => l.log),
    closedIds: ordered.flatMap((l) => l.closedIds),
    commits: ordered.reduce((n, l) => n + l.commits, 0),
    error: run.error ?? ordered.find((l) => l.error)?.error ?? null,
    stopRequested: run.phase === "stopped",
  };
}

function projectPhase(run: LoopRunRecord, last: LoopLaneRecord | undefined): AutopilotPhase {
  if (run.phase === "done" || run.phase === "stopped" || run.phase === "error") return run.phase;
  if (!last) return "starting";
  switch (last.phase) {
    case "queued":
      return "starting";
    case "dispatching":
      return "dispatching";
    // A finished lane inside a still-running run means the next cycle's rescan/dispatch is imminent;
    // "rescanning" is the honest last thing that happened, and never a terminal state here.
    case "rescanning":
    case "done":
      return "rescanning";
    case "error":
      return "error";
  }
}

/** The org's current (or most recent) single-repo autopilot job, or null.
 *  A live multi-repo run is skipped, not projected: the band must not look like it owns a fleet pass. */
export async function getAutopilotJob(org: string): Promise<AutopilotJob | null> {
  // Same sweep GET /api/org/loop runs before it reads. A `running` row this process does not own
  // is a restart casualty; projecting it as the live job would leave the band spinning. Swallow a
  // sweep failure — the read must still answer.
  await markStaleRunsStopped(org, isLoopRunLive).catch(() => 0);
  const active = await getActiveLoopRun(org);
  const run = active && isSingleRepoRun(active) ? active : await mostRecentSingleRepoRun(org);
  if (!run) return null;
  return toAutopilotJob(org, run, await listLanes(run.id));
}

async function mostRecentSingleRepoRun(org: string): Promise<LoopRunRecord | null> {
  // listLoopRuns caps at 100; taking only the newest row would hide the last autopilot behind a
  // later fleet pass.
  const recent = await listLoopRuns(org, 100);
  for (const row of recent) {
    if (!isSingleRepoRun(row)) continue;
    const run = await getLoopRun(row.id);
    if (run && isSingleRepoRun(run)) return run;
  }
  return null;
}

/** Cooperative stop for the org's active single-repo run. A multi-repo loop is not this job. */
export async function requestAutopilotStop(org: string): Promise<boolean> {
  const active = await getActiveLoopRun(org);
  if (!active || !isSingleRepoRun(active)) return false;
  return stopLoopRun(active.id);
}

/**
 * Arm a single-repo run. `path` is accepted for call-site compatibility and deliberately unused —
 * the engine resolves and re-verifies the pairing itself, so there is exactly one place that decides
 * whether a repo may be worked.
 */
export async function startAutopilot(opts: {
  org: string;
  repo: string;
  path?: string;
  maxCycles: number;
  deps?: Partial<LaneDeps>;
}): Promise<AutopilotJob> {
  const run = await startLoopRun({
    org: opts.org,
    repos: [opts.repo],
    maxCycles: opts.maxCycles,
    concurrency: 1,
    deps: opts.deps,
    branchFor: (_repo, stamp) => `ascent/autopilot-${stamp}`,
  });
  const job = toAutopilotJob(opts.org, run, await listLanes(run.id));
  if (!job) throw new Error("Autopilot can only arm a single-repo run.");
  return job;
}
