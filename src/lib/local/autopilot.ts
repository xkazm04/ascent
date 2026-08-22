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

import { LOOP_MAX_CYCLES_CAP, getActiveLoopRun, listLanes, listLoopRuns, getLoopRun, type LoopLaneRecord, type LoopRunRecord } from "@/lib/db/loop-runs";
import { startLoopRun, stopLoopRun } from "@/lib/local/loop-engine";
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

/** Project a single-repo run + its lanes back into the legacy job shape. Pure; exported for tests. */
export function toAutopilotJob(org: string, run: LoopRunRecord, lanes: readonly LoopLaneRecord[]): AutopilotJob {
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

/** The org's current (or most recent) single-repo autopilot job, or null. */
export async function getAutopilotJob(org: string): Promise<AutopilotJob | null> {
  const active = await getActiveLoopRun(org);
  const run = active ?? (await mostRecentRun(org));
  if (!run) return null;
  return toAutopilotJob(org, run, await listLanes(run.id));
}

async function mostRecentRun(org: string): Promise<LoopRunRecord | null> {
  const [newest] = await listLoopRuns(org, 1);
  return newest ? await getLoopRun(newest.id) : null;
}

/** Cooperative stop for the org's active run. */
export async function requestAutopilotStop(org: string): Promise<boolean> {
  const active = await getActiveLoopRun(org);
  if (!active) return false;
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
  return toAutopilotJob(opts.org, run, await listLanes(run.id));
}
