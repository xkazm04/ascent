// LOOP ENGINE — the local-mode improvement loop, generalized from one repo to a selected SET of them.
//
// Mechanics are unchanged from the autopilot this replaces (worktree → local `claude -p` agent →
// rescan from disk so `Ascent-Resolves:` trailers close their rows). What changed is the shape:
//
//   • A run works N repos as N LANES with bounded parallelism (default 2, hard cap 4). One lane's
//     failure is lane data — the run keeps going — because the alternative, aborting a fleet pass on
//     one bad repo, throws away the work the other lanes already committed.
//   • The DB is the source of truth (src/lib/db/loop-runs.ts). This module's in-memory registry holds
//     ONLY what cannot be serialized: the cooperative stop flag and the live worktree handles. A
//     `running` row that this process has no registry entry for is therefore, by construction, a
//     restart casualty — markStaleRunsStopped reconciles it rather than pretending it can resume.
//
// GATES, each still load-bearing and each checked HERE as well as at the route: selfHosted() (these
// APIs read the server's filesystem and spawn processes), autopilotEnabled() / ASCENT_AUTOPILOT=1
// (spawning an auto-editing agent is a deliberate opt-in even on your own box), and a verified local
// pairing for EVERY repo in the set (a broken pairing must refuse the whole run, not fail lane by
// lane after the operator walked away).

import { selfHosted } from "@/lib/env";
import { mapPool } from "@/lib/pool";
import { autopilotEnabled } from "@/lib/local/agent";
import { verifyLocalPath } from "@/lib/local/pairing";
import { getRepoLocalPath } from "@/lib/db";
import {
  LOOP_CONCURRENCY_CAP,
  LOOP_DEFAULT_CONCURRENCY,
  LOOP_MAX_CYCLES_CAP,
  createLoopRun,
  getActiveLoopRun,
  getLane,
  getLoopRun,
  appendLaneLog,
  markStaleRunsStopped,
  updateLane,
  updateLoopRun,
  upsertLane,
  type LoopRunRecord,
} from "@/lib/db/loop-runs";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { runLane, type LaneDeps } from "@/lib/local/loop-lane";
import { createLoopWorktree, removeLoopWorktree, runStamp, type LoopWorktree } from "@/lib/local/loop-worktree";

/** Live, unserializable state for one in-flight run. Everything else lives in the DB. */
interface LiveRun {
  runId: string;
  orgSlug: string;
  stopRequested: boolean;
  worktrees: Map<string, LoopWorktree>;
}

const live = new Map<string, LiveRun>(); // keyed by run id

export interface StartLoopRunInput {
  org: string;
  repos: string[];
  /** Curated batch (Recommendation ids) per repo, applied to CYCLE 1 only. */
  batches?: Record<string, string[]>;
  concurrency?: number;
  maxCycles?: number;
  curated?: boolean;
  /** GitHub login arming the run, for the audit trail on the row. */
  actor?: string | null;
  /** Test seam + the autopilot shim's legacy branch naming. */
  deps?: Partial<LaneDeps>;
  branchFor?: (repo: string, stamp: string) => string;
}

/**
 * Arm a run and return its row immediately — the loop itself runs detached, and the UI polls
 * `/api/org/loop`. Throws with a human reason when it cannot start; every throw is a 409 at the route.
 */
export async function startLoopRun(input: StartLoopRunInput): Promise<LoopRunRecord> {
  const org = input.org.trim().toLowerCase();
  if (!selfHosted()) throw new Error("The improvement loop only runs on a self-hosted deployment.");
  if (!autopilotEnabled()) {
    throw new Error(
      "The loop is not enabled on this deployment — set ASCENT_AUTOPILOT=1 (and make sure the claude CLI is available).",
    );
  }
  const repos = [...new Set(input.repos.map((r) => r.trim()).filter(Boolean))];
  if (repos.length === 0) throw new Error("Pick at least one repository for the loop.");

  // A `running` row with no live registry entry died with a previous process — reconcile BEFORE the
  // one-run-per-org check, or a single crash would bar the org from ever starting another run.
  await markStaleRunsStopped(org);
  const active = await getActiveLoopRun(org);
  if (active && live.has(active.id)) throw new Error(`A loop run is already active for ${org}.`);

  // Resolve + verify EVERY pairing up front: a half-armed run that discovers a broken pairing three
  // lanes in has already spent an agent session on the others.
  const targets: { repo: string; path: string }[] = [];
  for (const repo of repos) {
    const path = await getRepoLocalPath(org, repo);
    if (!path) throw new Error(`${repo} is not paired with a local path — pair it on Admin → Pairing.`);
    const check = await verifyLocalPath(path, repo);
    if (!check.ok) throw new Error(`Pairing broken for ${repo}: ${check.error}`);
    targets.push({ repo, path });
  }

  const run = await createLoopRun({
    orgSlug: org,
    repos,
    concurrency: input.concurrency ?? LOOP_DEFAULT_CONCURRENCY,
    maxCycles: input.maxCycles ?? 3,
    curated: input.curated,
    createdBy: input.actor ?? null,
    phase: "running",
  });
  if (!run) throw new Error("The loop requires a database.");

  const state: LiveRun = { runId: run.id, orgSlug: org, stopRequested: false, worktrees: new Map() };
  live.set(run.id, state);
  void drive(run, targets, input, state).catch(async (err) => {
    await updateLoopRun(run.id, {
      phase: "error",
      error: err instanceof Error ? err.message : String(err),
      endedAt: new Date(),
    });
    live.delete(run.id);
  });
  return run;
}

/** Cooperative stop: in-flight lanes finish their current phase, then the run winds down. */
export async function stopLoopRun(id: string): Promise<boolean> {
  const state = live.get(id);
  if (state) {
    if (state.stopRequested) return true;
    state.stopRequested = true;
    return true;
  }
  // Not ours: either already finished, or a restart casualty. Reconcile rather than no-op.
  const run = await getLoopRun(id);
  if (!run || run.endedAt) return false;
  await updateLoopRun(id, { phase: "stopped", endedAt: new Date() });
  return true;
}

/**
 * Re-run one failed lane on a FRESH worktree.
 *
 * A retry deliberately does not reuse the original branch: by the time anyone retries, the run has
 * ended and its worktree is gone, and re-creating a worktree on an existing branch would either fail
 * or silently re-target whatever that branch now points at. A new branch off HEAD is the honest,
 * reviewable unit — the same contract every other lane gets.
 */
export async function retryLane(laneId: string, opts: { deps?: Partial<LaneDeps> } = {}): Promise<boolean> {
  if (!selfHosted() || !autopilotEnabled()) return false;
  const lane = await getLane(laneId);
  if (!lane) return false;
  if (lane.phase === "dispatching" || lane.phase === "rescanning") return false; // in flight — never double-dispatch
  const run = await getLoopRun(lane.runId);
  if (!run) return false;
  const org = await orgSlugOf(run);
  if (!org) return false;
  const path = await getRepoLocalPath(org, lane.repoFullName);
  if (!path) return false;

  await updateLane(laneId, { phase: "queued", error: null, endedAt: null, stage: null });
  void (async () => {
    let wt: LoopWorktree | null = null;
    try {
      wt = await createLoopWorktree(path, lane.repoFullName, runStamp());
      await runLane({
        runId: run.id,
        org,
        repo: lane.repoFullName,
        cycle: lane.cycle,
        worktree: wt,
        batch: lane.batchIds.length > 0 ? lane.batchIds : null,
        deps: opts.deps,
      });
    } catch (err) {
      await updateLane(laneId, {
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
        endedAt: new Date(),
      });
    } finally {
      if (wt) await removeLoopWorktree(wt);
    }
  })();
  return true;
}

/** True while THIS process is driving the run (i.e. a stop can still be honoured cooperatively). */
export function isLoopRunLive(id: string): boolean {
  return live.has(id);
}

// ── the driver ───────────────────────────────────────────────────────────────────────────────────

async function drive(
  run: LoopRunRecord,
  targets: { repo: string; path: string }[],
  input: StartLoopRunInput,
  state: LiveRun,
): Promise<void> {
  const stamp = runStamp();
  const branchFor = input.branchFor;
  // Repos still worth another cycle. A repo whose cycle produced neither a commit nor a closed row
  // drops out — the autopilot's early-stop rule, applied per lane instead of per run, so one stalled
  // repo no longer ends the whole fleet's pass.
  let activeTargets = targets;
  try {
    for (let cycle = 1; cycle <= run.maxCycles; cycle += 1) {
      if (state.stopRequested || activeTargets.length === 0) break;
      await updateLoopRun(run.id, { cycle });
      const batches = cycle === 1 ? (input.batches ?? {}) : {};
      const results = await mapPool(activeTargets, run.concurrency, async (t) => {
        if (state.stopRequested) return { repo: t.repo, progressed: false };
        let wt = state.worktrees.get(t.repo);
        if (!wt) {
          try {
            wt = await createLoopWorktree(t.path, t.repo, stamp, branchFor);
            state.worktrees.set(t.repo, wt);
          } catch (err) {
            await recordLaneSetupFailure(run.id, t.repo, cycle, err);
            return { repo: t.repo, progressed: false };
          }
        }
        const res = await runLane({
          runId: run.id,
          org: state.orgSlug,
          repo: t.repo,
          cycle,
          worktree: wt,
          batch: batches[t.repo] ?? null,
          deps: input.deps,
          shouldStop: () => state.stopRequested,
        });
        return { repo: t.repo, progressed: res.progressed };
      });
      const kept = new Set(results.filter((r) => r.progressed).map((r) => r.repo));
      activeTargets = activeTargets.filter((t) => kept.has(t.repo));
    }
    await updateLoopRun(run.id, { phase: state.stopRequested ? "stopped" : "done", endedAt: new Date() });
  } finally {
    for (const wt of state.worktrees.values()) await removeLoopWorktree(wt);
    live.delete(run.id);
  }
}

/** A worktree that could not be created is a lane error, not a run error. */
async function recordLaneSetupFailure(runId: string, repo: string, cycle: number, err: unknown): Promise<void> {
  const lane = await upsertLane({ runId, repoFullName: repo, cycle });
  if (!lane) return;
  const message = err instanceof Error ? err.message : String(err);
  await appendLaneLog(lane.id, message);
  await updateLane(lane.id, { phase: "error", error: message, endedAt: new Date() });
}

async function orgSlugOf(run: LoopRunRecord): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const org = await getPrisma()
    .organization.findUnique({ where: { id: run.orgId }, select: { slug: true } })
    .catch(() => null);
  return org?.slug ?? null;
}

export { LOOP_CONCURRENCY_CAP, LOOP_DEFAULT_CONCURRENCY, LOOP_MAX_CYCLES_CAP };
