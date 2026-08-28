// LOOP ENGINE — the local-mode improvement loop, generalized from one repo to a selected SET of them.
//
// Mechanics are unchanged from the autopilot this replaces (worktree → local `claude -p` agent →
// rescan from disk so `Ascent-Resolves:` trailers close their rows). What changed is the shape:
//
//   • A run works N repos as N LANES with bounded parallelism (default 2, hard cap 4). One lane's
//     failure is lane data — the run keeps going — because the alternative, aborting a fleet pass on
//     one bad repo, throws away the work the other lanes already committed.
//   • A lane has a KIND, decided per repo at ARM time from the paired working copy by the same
//     `proposeLaneKind` the curation panel calls: `foundation` when the repo has no `.ai/` standard,
//     `practice` when the biggest open gap has a Practice Library starter the repo is missing, and
//     the agent lane for everything else. The first two are deterministic file writes — no agent
//     session — and they apply to CYCLE 1 only, so a run reads "install, rescan, then work the gaps".
//     This is what closes UC1's loop locally: before it, installing the standard or a practice was a
//     separate GitHub-App draft-PR door the local loop never opened.
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
import { autopilotEnabled, resolveAgentConfig } from "@/lib/local/agent";
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
import type { LoopTarget } from "@/lib/db/loop-runs-types";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { BACKLOG_LANE, type LaneKindProposal } from "@/lib/local/lane-kind";
import { defaultLaneDeps, runLane, type LaneDeps } from "@/lib/local/loop-lane";
import { createLoopWorktree, removeLoopWorktree, runStamp, type LoopWorktree } from "@/lib/local/loop-worktree";

/** One repo of a run: where it lives on disk, and what its FIRST cycle was armed to do. */
interface LaneTargetPlan {
  repo: string;
  path: string;
  plan: LaneKindProposal;
}

/** Live, unserializable state for one in-flight run. Everything else lives in the DB. */
interface LiveRun {
  runId: string;
  orgSlug: string;
  stopRequested: boolean;
  worktrees: Map<string, LoopWorktree>;
}

// ONE registry per PROCESS, on globalThis — not per module instance. Next bundles each API route
// into its own server chunk, and a module-level `const live = new Map()` is instantiated once PER
// CHUNK: a run started from one route (the drive door) was invisible to the loop route, whose
// stale-run reconcile then judged it dead and marked it stopped 35 seconds into cycle 1 (2026-08-26).
// Same hazard, same fix as pglite-boot's adapter handle. Keyed by run id.
const LIVE_KEY = "__ascentLoopLive" as const;
const live: Map<string, LiveRun> = ((globalThis as unknown as Record<string, unknown>)[LIVE_KEY] ??=
  new Map<string, LiveRun>()) as Map<string, LiveRun>;

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
  /** The operator's per-run agent pick (already normalized by the route). Resolved against the
   *  deployment's env HERE, once, and the resolved values are what land on the row. */
  model?: string | null;
  effort?: string | null;
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
  await markStaleRunsStopped(org, isLoopRunLive);
  const active = await getActiveLoopRun(org);
  if (active && live.has(active.id)) throw new Error(`A loop run is already active for ${org}.`);

  // Resolve + verify EVERY pairing up front: a half-armed run that discovers a broken pairing three
  // lanes in has already spent an agent session on the others.
  const targets: LaneTargetPlan[] = [];
  const laneKind = input.deps?.laneKind ?? defaultLaneDeps.laneKind;
  const openBatch = input.deps?.openBatch ?? defaultLaneDeps.openBatch;
  for (const repo of repos) {
    const path = await getRepoLocalPath(org, repo);
    if (!path) throw new Error(`${repo} is not paired with a local path — pair it on Admin → Pairing.`);
    const check = await verifyLocalPath(path, repo);
    if (!check.ok) throw new Error(`Pairing broken for ${repo}: ${check.error}`);
    // The SAME rule the curation panel showed (GET /api/org/loop/propose calls this function too), so
    // a proposal that led with "install the .ai/ foundation" cannot turn into an agent session on the
    // way to the engine. Re-read here rather than trusted from the wire: the operator may have
    // installed the standard by hand between opening the panel and pressing Run.
    const plan = await laneKind(path, () => openBatch(org, repo).catch(() => []));
    targets.push({ repo, path, plan });
  }

  // Resolve ONCE, at arm time, and persist what was resolved. A row that recorded the raw pick would
  // read `null` for every default run, i.e. "whatever CLAUDE_MODEL was that day" — the one fact the
  // ledger needs and the only one an env var cannot recover afterwards.
  const agent = resolveAgentConfig({ model: input.model, effort: input.effort });
  const run = await createLoopRun({
    orgSlug: org,
    repos,
    // The armed kinds ride on the row, so the outcome ledger can still say what each lane DID long
    // after the run ended and the process that drove it is gone.
    targets: targets.map<LoopTarget>((t) => ({ repo: t.repo, kind: t.plan.kind, practiceId: t.plan.practiceId })),
    concurrency: input.concurrency ?? LOOP_DEFAULT_CONCURRENCY,
    maxCycles: input.maxCycles ?? 3,
    curated: input.curated,
    createdBy: input.actor ?? null,
    model: agent.model,
    effort: agent.effort,
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
      const target = run.targets.find((t) => t.repo === lane.repoFullName);
      // A retry re-runs the SAME lane, which includes its KIND: re-deciding it against today's disk
      // would silently turn a failed foundation lane into an agent session (or the reverse) under the
      // same lane row. `laneKindOf`'s cycle-1 rule applies here too.
      const kind = lane.cycle === 1 ? (target?.kind ?? "backlog") : "backlog";
      await runLane({
        runId: run.id,
        org,
        repo: lane.repoFullName,
        cycle: lane.cycle,
        worktree: wt,
        batch: lane.batchIds.length > 0 ? lane.batchIds : null,
        kind,
        practiceId: target?.practiceId ?? null,
        reason: `retry of a ${kind} lane`,
        deps: opts.deps,
        // A retry re-runs the SAME experiment: the run's recorded configuration, not today's env.
        agent: { model: run.model, effort: run.effort },
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
  targets: LaneTargetPlan[],
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
        // A foundation/practice lane is a CYCLE-1 lane: once the standard (or the starter) is in, the
        // repo's next cycle is ordinary backlog work with the new floor in place. Same shape as the
        // curated batch above, and the rule `laneKindOf` reads back off the row.
        //
        // A curated batch WINS over a practice lane: the operator naming rows is an explicit
        // instruction, and a practice lane whose item they pruned would install a starter for a gap
        // they just declined. A foundation lane has no rows to curate, so nothing can contradict it.
        const curatedIds = batches[t.repo];
        const plan =
          cycle !== 1 || (t.plan.kind === "practice" && curatedIds != null && !curatedIds.includes(t.plan.itemId ?? ""))
            ? BACKLOG_LANE
            : t.plan;
        const res = await runLane({
          runId: run.id,
          org: state.orgSlug,
          repo: t.repo,
          cycle,
          worktree: wt,
          // A practice lane answers exactly one row — the highest-impact gap its starter is for — so
          // it names that row as its batch and the trailer closes it, or the rescan declines to.
          batch: plan.kind === "practice" && plan.itemId ? [plan.itemId] : (batches[t.repo] ?? null),
          kind: plan.kind,
          practiceId: plan.practiceId,
          reason: plan.reason,
          deps: input.deps,
          // Every cycle of a run uses the run's configuration — read off the ROW rather than the
          // input, so a retry dispatched hours later cannot silently pick up a changed env.
          agent: { model: run.model, effort: run.effort },
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
