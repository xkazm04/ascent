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
import type { LoopModelPolicy, LoopTarget } from "@/lib/db/loop-runs-types";
import { MAX_COMPARE_ARMS, MIN_COMPARE_ARMS, normalizeArmSet, type Arm, type ArmPolicy } from "@/lib/local/arm";
import type { LoopDelivery } from "@/lib/local/delivery-options";
// ADR-0001 — the hosted gate. The pure decision table and the IO that feeds it are separate modules
// on purpose: `hostedGateBlock` is a table a test can walk, and nothing in it can reach a database.
import { hostedBlockReason, hostedGateBlock, type HostedBlock, type HostedGateFacts } from "@/lib/local/hosted-gate";
import type { HostedReservation } from "@/lib/db/hosted-credits";
import { batchSizeOf, verifyModeOf, type VerifyMode } from "@/lib/local/run-limits";
// The guard's baseline cache is keyed by worktree DIRECTORY and lives for the life of the process, so
// the one place that deletes a worktree is the one place that must forget its entry.
import { forgetVerifyBaseline } from "@/lib/local/lane-guard";
import { deliverLane } from "@/lib/local/loop-delivery";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/scans-audit";
import { BACKLOG_LANE, type LaneKindProposal } from "@/lib/local/lane-kind";
import {
  abandonDeferredCycles,
  defaultLaneDeps,
  runLane,
  settleDeferredCycles,
  type DeferredCycle,
  type LaneDeps,
  type RescanCadence,
} from "@/lib/local/loop-lane";
// A STOP WITH TEETH. The flag alone is a cooperative signal a wedged lane never reads; these are the
// grace it is given and the watchdog handle that ends it when it does not take.
import { LANE_STOP_GRACE_MS, LANE_STOP_TERMINAL_MS, type LaneWatchdog } from "@/lib/local/lane-watchdog";
import { createLoopWorktree, removeLoopWorktree, runStamp, type LoopWorktree } from "@/lib/local/loop-worktree";
import { RUNNER_BRANCH } from "@/lib/local/runner-types";

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
  /** THE IN-FLIGHT LANES' WATCHDOGS, keyed by `<repo>[#arm]#<cycle>`. This is what makes a stop
   *  enforceable: a lane inside a call that will not return is force-failed through the same
   *  watchdog its own deadline uses. Unserializable, so it belongs here by the module header's rule. */
  lanes: Map<string, LaneWatchdog>;
  /** The stop's two timers (grace, then the terminal backstop), so a run that ends normally clears
   *  them instead of leaving them armed. */
  stopTimers: ReturnType<typeof setTimeout>[];
  /** THE REPOS THAT HAVE SPENT THIS RUN'S ONE DRY-LANE REFRESH. A lane that finds no work at all
   *  re-reads the paired checkout so the repo's stale roadmap can recover (`DryLaneRefresh` in
   *  loop-lane.ts) — once per repo, for the life of the run. The bound lives HERE rather than in the
   *  lane because the lane keeps no module state by its own header's rule, and because a per-run Set
   *  is cleaned up with the run instead of accumulating in the process. Not keyed by ARM: two arms of
   *  one repo read the same checkout, so a second scan of it would be the same reading twice. */
  refreshed: Set<string>;
  /** True once the stop backstop has written this run terminal — `drive` must not then overwrite the
   *  row that names the lanes which refused to die. */
  terminated: boolean;
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
  /** `single` (the default, and what every run before #27 was), `ab`, or `compare`. */
  modelPolicy?: LoopModelPolicy;
  /** The two arms of an `ab` run, in order. Ignored under `single` and under `compare`. */
  models?: string[];
  /** THE ARMS (src/lib/local/arm.ts) — one transport + one model each, optionally with a different
   *  planning half. Supersedes `models`, which could only name Claude aliases. Omitted = a pre-arms
   *  run, which is byte-identical to everything above. */
  arms?: Arm[];
  /** `single` (one arm drives the run) or `compare` (2..4 arms race one curated batch). Only read
   *  when `arms` is present. */
  armPolicy?: ArmPolicy | null;
  /** The transport probe taken before the run was armed, already serialized (WP4). */
  probeJson?: string | null;
  /** WHAT HAPPENS TO EACH LANE'S BRANCH once its cycle succeeds — `branch` (the default, and exactly
   *  what every run before this did), `land` or `pr`. Already validated by the route. */
  delivery?: LoopDelivery | null;
  /** THE THROUGHPUT + GUARD DIALS, already validated by the route (`run-limits.ts`). Every one is
   *  optional and `null`/omitted records null, which reads back as the deployment default — so a run
   *  armed without them behaves byte-identically to every run before they existed. */
  batchSize?: number | null;
  agentTimeoutMs?: number | null;
  /** `off` is the operator's explicit refusal to run repo-authored verification commands. Omitted =
   *  `on`, which is the guard's default posture. */
  verifyMode?: VerifyMode | null;
  verifyTimeoutMs?: number | null;
  /** HOW OFTEN THIS RUN RESCANS — `"cycle"` (the default, and byte-identical to every run before the
   *  parameter existed) or `"run"`, which rescans ONCE after the last cycle a repo progressed in.
   *  DEFAULTED TO TODAY ON PURPOSE: deferring the reading changes what a lane row carries while the
   *  run is still in flight (an intermediate cycle's `afterScanId`/`closedIds` arrive at the end
   *  rather than at its own close), so a default-parameter run would NOT be byte-identical and the
   *  brief's own rule says the new cadence must be opted into. See `RescanCadence` in loop-lane.ts.
   *  Held on the run's input rather than persisted on the row: a retry re-runs one lane in isolation,
   *  where there is no "rest of the run" to defer to, so a retry is always `"cycle"`. */
  rescanCadence?: RescanCadence | null;
  // ── THE STANDING RUNNER (spark theater-upgrade, 2026-09-18). All optional; omitted = a manual run,
  // byte-identical to every run before the runner existed.
  /** The drive that dispatched this run — persisted on the row so the ledger can group runs by drive. */
  driveId?: string | null;
  /** `on` = every lane opens with a read-only planning session and only architecture moves wait for a
   *  human. Persisted (`LoopRun.planMode`) so a retry plans exactly as the original did. */
  planMode?: "on" | null;
  /** What every lane's branch is cut from. Omitted = `HEAD`; the runner passes its runner branch. */
  baseRef?: string | null;
  /** RUNNER-GRADE LANES: lessons from a verified lane are kept automatically, and a lane that changed a
   *  manifest has its dependencies installed by the engine. NOT persisted — a retry is a manual act and
   *  gets neither. */
  runnerLane?: { autoKeepLessons: boolean; installDeps: boolean } | null;
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
  const dispatchedPractices = input.deps?.dispatchedPractices ?? defaultLaneDeps.dispatchedPractices;
  for (const repo of repos) {
    const path = await getRepoLocalPath(org, repo);
    if (!path) throw new Error(`${repo} is not paired with a local path — pair it on Admin → Pairing.`);
    const check = await verifyLocalPath(path, repo);
    if (!check.ok) throw new Error(`Pairing broken for ${repo}: ${check.error}`);
    // The SAME rule the curation panel showed (GET /api/org/loop/propose calls this function too), so
    // a proposal that led with "install the .ai/ foundation" cannot turn into an agent session on the
    // way to the engine. Re-read here rather than trusted from the wire: the operator may have
    // installed the standard by hand between opening the panel and pressing Run.
    const plan = await laneKind(
      path,
      // The PROPOSAL reads the same sized batch the dispatch will: a kind decided against five items
      // and then dispatched with ten would be a proposal about a different lane.
      () => openBatch(org, repo, batchSizeOf(input.batchSize)).catch(() => []),
      // The ONCE-PER-REPO gate on practice lanes. A failed read degrades to "nothing dispatched",
      // which is the same honest default every other unreadable-evidence path here takes.
      () => dispatchedPractices(org, repo).catch(() => new Set<string>()),
    );
    // A practice the rule DECLINED to re-raise becomes a lesson, so an operator looking at a backlog
    // lane on a repo with an obvious starter-shaped gap can see why. Written once per armed run and
    // deduplicated in the store — the skip is a standing fact, not an event.
    if (plan.skippedPracticeId) await noteSkippedPractice(org, repo, plan.skippedPracticeId);
    targets.push({ repo, path, plan });
  }

  // Resolve ONCE, at arm time, and persist what was resolved. A row that recorded the raw pick would
  // read `null` for every default run, i.e. "whatever CLAUDE_MODEL was that day" — the one fact the
  // ledger needs and the only one an env var cannot recover afterwards.
  const agent = resolveAgentConfig({ model: input.model, effort: input.effort });
  // THE ARMS OF THE EXPERIMENT, in two vocabularies that deliberately do not merge.
  //
  // `arms` is the ARM shape (transport + model, optionally a different planning half) and is what a
  // run armed today carries. `models` is the pre-arms pair of Claude aliases; an `ab` run recorded
  // with it keeps reading as `ab` forever, so an existing run replays unchanged. A run given neither
  // is exactly the `single` run it always was.
  const armed = input.arms && input.arms.length > 0 ? input.arms : null;
  const armPolicy: ArmPolicy | null = armed ? (input.armPolicy === "compare" ? "compare" : "single") : null;
  if (armed) {
    // Re-validated HERE as well as at the route, because the engine is also called from the drive and
    // from tests. `normalizeArmSet` owns the count, the id-distinctness and the token rules.
    if (!normalizeArmSet(armed, armPolicy ?? "single")) {
      throw new Error(
        armPolicy === "compare"
          ? `A comparison run needs ${MIN_COMPARE_ARMS}–${MAX_COMPARE_ARMS} arms with distinct ids.`
          : "A single-arm run needs exactly one valid arm.",
      );
    }
  }
  const policy: LoopModelPolicy =
    armPolicy === "compare" ? "compare" : input.modelPolicy === "ab" ? "ab" : "single";
  const arms = policy === "ab" ? [...new Set((input.models ?? []).map((m) => m.trim()).filter(Boolean))] : [agent.model];
  if (policy === "ab") {
    if (arms.length !== 2) throw new Error("An A/B run needs exactly two distinct models.");
    // Both arms of a repo run in the SAME cycle, so an `ab` run has twice as many lanes in flight as
    // its concurrency dial says. Refuse with the reason rather than quietly exceeding the budget that
    // exists because four local `claude -p` sessions already saturate a developer box.
    const inFlight = (input.concurrency ?? LOOP_DEFAULT_CONCURRENCY) * 2;
    if (inFlight > LOOP_CONCURRENCY_CAP) {
      throw new Error(
        `An A/B run doubles the lanes in flight (${inFlight}), past the cap of ${LOOP_CONCURRENCY_CAP} — lower the lane count to ${Math.floor(LOOP_CONCURRENCY_CAP / 2)} or run one model at a time.`,
      );
    }
  }
  if (policy === "compare" && armed) {
    // The same budget rule as `ab`, with N in place of 2 — every arm of a repo runs in the SAME
    // cycle, so an N-arm run has N times as many lanes in flight as the concurrency dial says.
    const inFlight = (input.concurrency ?? LOOP_DEFAULT_CONCURRENCY) * armed.length;
    if (inFlight > LOOP_CONCURRENCY_CAP) {
      throw new Error(
        `A ${armed.length}-arm comparison puts ${inFlight} lanes in flight, past the cap of ${LOOP_CONCURRENCY_CAP} — lower the lane count to ${Math.max(1, Math.floor(LOOP_CONCURRENCY_CAP / armed.length))} or compare fewer arms.`,
      );
    }
  }
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
    // The run-level `model` stays the FIRST arm, so every pre-#27 reader (the history strip's setup
    // line, a retry's inherited configuration) keeps working and reads something true.
    // The run-level `model` stays the first EXECUTING model — under `compare` that is the first
    // arm's, so every pre-arms reader still reads something true rather than nothing.
    model: armed ? (armed[0]?.model ?? agent.model) : (arms[0] ?? agent.model),
    effort: agent.effort,
    modelPolicy: policy,
    models: armed ? armed.map((a) => a.model) : arms,
    arms: armed,
    armPolicy,
    probeJson: input.probeJson ?? null,
    delivery: input.delivery ?? null,
    batchSize: input.batchSize ?? null,
    agentTimeoutMs: input.agentTimeoutMs ?? null,
    verifyMode: input.verifyMode ?? null,
    verifyTimeoutMs: input.verifyTimeoutMs ?? null,
    driveId: input.driveId ?? null,
    planMode: input.planMode === "on" ? "on" : null,
    phase: "running",
  });
  if (!run) throw new Error("The loop requires a database.");

  const state: LiveRun = {
    runId: run.id,
    orgSlug: org,
    stopRequested: false,
    worktrees: new Map(),
    lanes: new Map(),
    stopTimers: [],
    refreshed: new Set<string>(),
    terminated: false,
  };
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

export interface StartRemoteRunInput {
  org: string;
  repos: string[];
  /** The proposed batch per repo, from `/propose`. Stamped on each lane at arm time. */
  batches?: Record<string, string[]>;
  actor?: string | null;
}

/**
 * ARM A RUN NOBODY HERE WILL DRIVE (moonshot #3) — the hosted half of the work protocol.
 *
 * This is the function that finally writes a `LoopRun` in phase `curating`. The phase has been the
 * schema default and a readable value since the loop shipped, and no code path ever wrote a row in
 * it — `live.md` said so under Known gaps. `curating` is exactly right here: the run EXISTS, its
 * lanes name their repos and their proposed batches, and nothing is in flight until an agent
 * somewhere else claims into one of them.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, and the list is the design: no `selfHosted()` check, no
 * `autopilotEnabled()` check, no pairing verification, no worktree, no process, no filesystem read.
 * Those four guards exist because `startLoopRun` spawns an editing agent inside a working copy on the
 * operator's own box. A remote run spawns nothing. Ascent never executes remote work — if a question
 * about this function is answered by "and then Ascent runs the agent", it is the wrong answer.
 *
 * There is also no live registry entry and no `drive()`. A remote run cannot be a restart casualty
 * because no process was ever driving it, which is why `markStaleRunsStopped` must never be pointed
 * at one: `isLoopRunLive` returning false for a remote run is the truth, not a death certificate.
 */
export async function startRemoteRun(input: StartRemoteRunInput): Promise<LoopRunRecord> {
  const org = input.org.trim().toLowerCase();
  const repos = [...new Set(input.repos.map((r) => r.trim()).filter(Boolean))];
  if (repos.length === 0) throw new Error("Pick at least one repository for the run.");

  const active = await getActiveLoopRun(org);
  if (active && live.has(active.id)) throw new Error(`A loop run is already active for ${org}.`);

  const run = await createLoopRun({
    orgSlug: org,
    repos,
    // Every remote lane is a `backlog` lane. `foundation` and `practice` are DETERMINISTIC INSTALLS
    // Ascent performs itself in a worktree it owns, which is precisely what a remote run has none of.
    targets: repos.map<LoopTarget>((repo) => ({ repo, kind: "backlog", practiceId: null })),
    concurrency: repos.length,
    maxCycles: 1,
    curated: Boolean(input.batches),
    createdBy: input.actor ?? null,
    // HONEST NULLS. Ascent does not choose the model a remote agent runs and never will, so the run's
    // `model` and `effort` stay null — unknown, not "the default". A figure here would be the first
    // false number in the economics fold.
    model: null,
    effort: null,
    modelPolicy: "single",
    models: [],
    phase: "curating",
  });
  if (!run) throw new Error("A remote run requires a database.");

  for (const repo of repos) {
    await upsertLane({
      runId: run.id,
      repoFullName: repo,
      cycle: 1,
      executor: "remote-agent",
      batchIds: input.batches?.[repo] ?? [],
    });
  }
  await recordAudit("loop.remote_run_started", { runId: run.id, repos, actor: input.actor ?? null }, { orgId: run.orgId });
  return run;
}

/** A refusal `startHostedRun` returns instead of a run. Carried rather than thrown so the route can
 *  answer with the block's OWN status code — 402 is fixable with money, 403 with a decision, 409 not
 *  by the caller at all, and collapsing all three into the 409 every other throw here becomes would
 *  tell an out-of-credit org that the server was busy. */
export class HostedRunRefused extends Error {
  constructor(
    readonly block: HostedBlock,
    message: string,
  ) {
    super(message);
    this.name = "HostedRunRefused";
  }
}

export interface StartHostedRunInput {
  org: string;
  repos: string[];
  /** The proposed batch per repo, from `/propose`. Stamped on each lane at arm time. */
  batches?: Record<string, string[]>;
  actor?: string | null;
  /** What the caller asked for. Anything but `pr` (or omitted) is refused — see the gate table. */
  delivery?: LoopDelivery | null;
  /** Test seam. Omitted = the real readers in hosted-dispatch.ts. */
  deps?: Partial<HostedRunDeps>;
}

export interface HostedRunDeps {
  facts: (org: string) => Promise<HostedGateFacts>;
  firstUnadmitted: (org: string, repos: readonly string[]) => Promise<string | null>;
  /** The per-org ceiling's arm-time debit (ADR-0001 T2). All-or-nothing for the whole run. */
  reserve: (args: { orgSlug: string; lanes: number; actor?: string | null }) => Promise<HostedReservation>;
  /** Give a reservation back when the run it paid for was never written. */
  refund: (args: { orgSlug: string; reservationId: string; charged: number }) => Promise<void>;
}

// IMPORTED LAZILY, AND THAT IS A DECISION RATHER THAN A STYLE. `hosted-dispatch.ts` is the IO half of
// the gate: it reaches `@/lib/db/credits` and `@/lib/db/org-admission`, and a static import here would
// put the whole Prisma surface on the import graph of a module that, for `local` and `remote-agent`
// runs, never needs it. The hosted gate's DECISION table (`hosted-gate.ts`) stays statically imported
// because it is pure. Reading it the other way round is also true: every caller who injects `deps`
// — the tests — gets a `startHostedRun` that touches no database module at all, not even to load one.
const defaultHostedDeps: HostedRunDeps = {
  facts: async (org) => (await import("@/lib/local/hosted-dispatch")).resolveHostedFacts(org),
  firstUnadmitted: async (org, repos) => (await import("@/lib/local/hosted-dispatch")).firstUnadmittedRepo(org, repos),
  reserve: async (args) => (await import("@/lib/db/hosted-credits")).reserveHostedRunCredits(args),
  refund: async (args) => (await import("@/lib/db/hosted-credits")).refundHostedReservation(args),
};

/**
 * ARM A RUN ASCENT CLOUD ITSELF WILL GET WORKED (ADR-0001) — `startRemoteRun`'s shape with the gate
 * table in front of it.
 *
 * The body is deliberately thin, because the decision this function embodies is that hosted dispatch
 * is NOT A SECOND ENGINE. Ascent still starts no process, opens no worktree and reads no filesystem;
 * the lanes land in `curating` exactly as a customer-armed remote run's do, and the only difference
 * on the row is `executor: "hosted-worker"` — which says who was asked, and is what keeps Ascent's
 * dispatcher and a customer's own harness out of each other's lanes.
 *
 * WHAT IT ADDS OVER `startRemoteRun`, and each one is a row of ADR-0001 §2:
 *   • a worker must exist on this deployment, or the lane would sit queued forever;
 *   • the org must be entitled (the per-org opt-in `ASCENT_AUTOPILOT` could not express);
 *   • the org must be under its monthly hosted ceiling AND pay the run's reservation, debited HERE,
 *     before any row is written, rather than discovered mid-cycle;
 *   • every repo must carry a recorded `agents-allowed` admission — the cloud proof that stands in
 *     for "this checkout is paired and we are allowed to edit it";
 *   • delivery is `pr`, full stop. `land` fast-forwards into a working copy hosted does not have,
 *     and a hosted agent must never write to a customer's default branch.
 *
 * `requireOrgRole("owner")` is NOT repeated here for the same reason `startRemoteRun` does not repeat
 * it: it is the route's, it was already tenancy-correct, and it applies to every executor.
 */
export async function startHostedRun(input: StartHostedRunInput): Promise<LoopRunRecord> {
  const org = input.org.trim().toLowerCase();
  const repos = [...new Set(input.repos.map((r) => r.trim()).filter(Boolean))];
  if (repos.length === 0) throw new Error("Pick at least one repository for the run.");

  // DELIVERY IS CHECKED FIRST, before any IO: it is a property of the REQUEST, and a caller who asked
  // for `land` gets told what is wrong with their request rather than what is wrong with their plan.
  if (input.delivery != null && input.delivery !== "pr") {
    throw new HostedRunRefused("delivery-not-pr", hostedBlockReason("delivery-not-pr"));
  }

  const deps = { ...defaultHostedDeps, ...input.deps };
  const block = hostedGateBlock(await deps.facts(org));
  if (block) throw new HostedRunRefused(block, hostedBlockReason(block));

  const unadmitted = await deps.firstUnadmitted(org, repos);
  if (unadmitted) throw new HostedRunRefused("repo-not-admitted", hostedBlockReason("repo-not-admitted", unadmitted));

  // ONE ACTIVE RUN PER ORG, AND HERE THAT MEANS ONE — not `active && live.has(active.id)`, which is
  // what `startRemoteRun` asks. That predicate reads "a run THIS process is driving", and no external
  // run ever is, so it lets a second one be armed on top of the first. A hosted run spends Ascent's
  // money, so it takes the strict reading ADR-0001's contract states. The cost of the strict reading
  // is that a wedged `curating` run blocks its org until someone stops it — which is exactly why
  // ADR-0001 puts the lease reaper (T7) in the same slice as the drain, and why no dispatcher is
  // registered before it exists.
  const active = await getActiveLoopRun(org);
  if (active) throw new Error(`A loop run is already active for ${org}.`);

  // THE CEILING (ADR-0001 T2), LAST AMONG THE GATES AND FIRST AMONG THE WRITES. Last, so a refusal on
  // anything else costs nothing; first, so no run or lane row can exist that was not paid for. The
  // status facts above only said ONE lane would fit; this is the authoritative, whole-run decision.
  const reservation = await deps.reserve({ orgSlug: org, lanes: repos.length, actor: input.actor ?? null });
  if (!reservation.ok) {
    throw new HostedRunRefused(reservation.block, hostedBlockReason(reservation.block));
  }
  const { reservationId, charged } = reservation;
  const refund = () => deps.refund({ orgSlug: org, reservationId, charged });

  const run = await createLoopRun({
    orgSlug: org,
    repos,
    // Every hosted lane is a `backlog` lane, for `startRemoteRun`'s reason: `foundation` and
    // `practice` are deterministic installs Ascent performs in a worktree it owns, and there is none.
    targets: repos.map<LoopTarget>((repo) => ({ repo, kind: "backlog", practiceId: null })),
    concurrency: repos.length,
    maxCycles: 1,
    curated: Boolean(input.batches),
    createdBy: input.actor ?? null,
    // HONEST NULLS, unchanged from the remote path. ADR-0001 leaves the provider a hosted worker runs
    // explicitly open, so Ascent has not chosen a model here either and must not record one.
    model: null,
    effort: null,
    modelPolicy: "single",
    models: [],
    phase: "curating",
    delivery: "pr",
  }).catch(async (err: unknown) => {
    await refund();
    throw err;
  });
  if (!run) {
    await refund();
    throw new Error("A hosted run requires a database.");
  }

  for (const repo of repos) {
    await upsertLane({
      runId: run.id,
      repoFullName: repo,
      cycle: 1,
      executor: "hosted-worker",
      batchIds: input.batches?.[repo] ?? [],
    });
  }
  await recordAudit(
    "loop.hosted_run_started",
    { runId: run.id, repos, actor: input.actor ?? null, reservationId, creditsCharged: charged },
    { orgId: run.orgId },
  );
  return run;
}

/**
 * Stop a run — cooperatively first, then with teeth.
 *
 * IT USED TO SET A FLAG AND NOTHING ELSE, and the flag is only read between a lane's phases: a lane
 * wedged in `rescanning/score` never reached one, so `stopLoopRun` returned ok, the phase stayed
 * `running` for 75 minutes, and only a dev-server restart cleared it. A stop that a stuck run can
 * ignore is not a stop.
 *
 * Three steps, in this order, because the cheapest one is also the one that preserves the most work:
 *   1. the FLAG, unchanged — a lane that reaches a checkpoint winds down cleanly, its commits intact;
 *   2. after `LANE_STOP_GRACE_MS`, every in-flight lane's watchdog is ABORTED, which force-fails it
 *      through the same path its own deadline uses — a terminal lane row naming the stage in flight;
 *   3. after `LANE_STOP_TERMINAL_MS` more, if the run is somehow STILL live, the row is written
 *      terminal anyway and says which lanes refused to die. A run that cannot be interrupted must
 *      still reach a terminal phase; leaving `running` on the row is the one outcome that is a lie.
 */
export async function stopLoopRun(id: string, opts: { graceMs?: number; terminalMs?: number } = {}): Promise<boolean> {
  // Both windows are overridable FOR TESTS ONLY — the route calls `stopLoopRun(id)` and gets the
  // constants. A caller that shortened the grace in production would be turning a cooperative stop
  // into a kill, which is the trade-off this function exists to make in the right order.
  const state = live.get(id);
  if (state) {
    if (state.stopRequested) return true;
    state.stopRequested = true;
    armStopTeeth(state, opts.graceMs ?? LANE_STOP_GRACE_MS, opts.terminalMs ?? LANE_STOP_TERMINAL_MS);
    return true;
  }
  // Not ours: either already finished, or a restart casualty. Reconcile rather than no-op.
  const run = await getLoopRun(id);
  if (!run || run.endedAt) return false;
  await updateLoopRun(id, { phase: "stopped", endedAt: new Date() });
  return true;
}

/** Step 2 and step 3 of the stop above, on timers that a normally-ending run clears (`clearStopTeeth`). */
function armStopTeeth(state: LiveRun, graceMs: number, terminalMs: number): void {
  const bite = setTimeout(() => {
    // Snapshot the names BEFORE aborting: an abort resolves the lane's race, and by the time the
    // backstop runs the map is (correctly) empty for every lane that took the hint.
    const inFlight = [...state.lanes.keys()];
    for (const watchdog of state.lanes.values()) watchdog.abort();
    if (inFlight.length === 0) return;
    const backstop = setTimeout(() => void terminateStuckRun(state, inFlight), terminalMs);
    (backstop as unknown as { unref?: () => void }).unref?.();
    state.stopTimers.push(backstop);
  }, graceMs);
  (bite as unknown as { unref?: () => void }).unref?.();
  state.stopTimers.push(bite);
}

function clearStopTeeth(state: LiveRun): void {
  for (const timer of state.stopTimers) clearTimeout(timer);
  state.stopTimers.length = 0;
}

/**
 * The backstop: the run was stopped, its lanes were aborted, and it is STILL live. Something below
 * the watchdog is not returning at all. Write the row terminal and NAME the lanes, then drop the
 * registry entry so the org is not barred from arming another run by a lane nobody can reach.
 */
async function terminateStuckRun(state: LiveRun, inFlight: string[]): Promise<void> {
  if (!live.has(state.runId) || state.terminated) return;
  const stuck = inFlight.filter((key) => state.lanes.has(key));
  if (stuck.length === 0) return; // they all wound down inside the window after all
  state.terminated = true;
  await updateLoopRun(state.runId, {
    phase: "stopped",
    endedAt: new Date(),
    error: `Stopped, but ${stuck.length} lane(s) did not terminate and were abandoned: ${stuck.join(", ")}. Their work is not delivered and their worktrees may still exist.`,
  });
  live.delete(state.runId);
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
      // A retried RUNNER lane is cut from the runner branch like its siblings — cut from HEAD, its
      // delivery onto `ascent/runner` would be refused as a non-fast-forward.
      wt = await createLoopWorktree(path, lane.repoFullName, runStamp(), undefined, run.delivery === "runner" ? RUNNER_BRANCH : "HEAD");
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
        // A retry re-runs the SAME experiment: the run's recorded configuration, not today's env —
        // and under `ab` that means the LANE's own arm, not the run's first one. Re-running arm B
        // under arm A's model would silently turn a comparison into two samples of one model.
        agent: { model: lane.model ?? run.model, effort: run.effort, timeoutMs: run.agentTimeoutMs },
        // …and the SAME ARM, rehydrated from the run's recorded set by the id the lane carries. A
        // retry that re-armed from today's defaults would silently re-run arm B's work as arm A.
        // Null when the lane predates arms, which is the retry path exactly as it always was.
        arm: (run.arms ?? []).find((a) => a.id === lane.armId) ?? null,
        // A retry re-runs the SAME experiment, which includes its throughput and its guard: read off
        // the ROW, never re-derived from today's env or defaults.
        batchSize: run.batchSize,
        verify: { enabled: verifyModeOf(run.verifyMode) === "on", timeoutMs: run.verifyTimeoutMs },
        abPairKey: lane.abPairKey,
        // A retry plans as the original run did (the row says so); the runner-grade flags are not
        // persisted, so a retry — a manual act — gets neither.
        runner: { plan: run.planMode === "on", autoKeepLessons: false, installDeps: false },
      });
      // A retry is the same lane run again, which includes how its work is delivered — the run's
      // recorded mode, read off the row rather than re-derived, exactly like its agent configuration.
      await deliverLane({
        delivery: run.delivery,
        // The run's GUARD dial travels with its delivery mode, and for the same reason: a lane is
        // delivered only when it was VERIFIED, and whether verification was asked for is a property
        // of the run's row, never of today's env.
        verifyMode: run.verifyMode,
        orgSlug: org,
        orgId: run.orgId,
        laneId,
        pairedPath: path,
        actor: run.createdBy,
      }).catch(() => null);
    } catch (err) {
      await updateLane(laneId, {
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
        endedAt: new Date(),
      });
    } finally {
      if (wt) {
        forgetVerifyBaseline(wt.dir);
        await removeLoopWorktree(wt);
      }
    }
  })();
  return true;
}

/** True while THIS process is driving the run (i.e. a stop can still be honoured cooperatively). */
export function isLoopRunLive(id: string): boolean {
  return live.has(id);
}

/**
 * Has a stop been REQUESTED on this run and not yet taken effect?
 *
 * The flag itself stays in the registry — it is the cooperative signal a running driver reads, and
 * the module header's rule ("only what cannot be serialized") holds. What was missing is that it was
 * also unreadable from outside, so the cockpit's Stop button reverted to "Stop" the moment the POST
 * returned and the run sat on `RUNNING` for the rest of the agent's session (PRIYA-L2-C6: 19m43s).
 * The registry is process-wide on `globalThis` for exactly this reason, so this read is exact for
 * every run this deployment is driving — and a run it is NOT driving is a restart casualty that
 * `markStaleRunsStopped` settles, never one whose stop is pending.
 */
export function loopRunStopRequested(id: string): boolean {
  return live.get(id)?.stopRequested === true;
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
  // THE RUN CADENCE (reflection 2026-09-01, item 7). `"cycle"` unless the run asked otherwise, which
  // is exactly what every run before this parameter did.
  const cadence: RescanCadence = input.rescanCadence === "run" ? "run" : "cycle";
  // COMMITTED CYCLES WHOSE READING IS STILL OWED, keyed by the same `<repo>[#arm]` the worktree is —
  // because the reading is of that worktree's branch. Declared outside the try so the `finally` can
  // give their claims back if the run ends without ever settling them.
  const pending = new Map<string, DeferredCycle[]>();
  try {
    for (let cycle = 1; cycle <= run.maxCycles; cycle += 1) {
      if (state.stopRequested || activeTargets.length === 0) break;
      await updateLoopRun(run.id, { cycle });
      const batches = cycle === 1 ? (input.batches ?? {}) : {};
      // ONE ARM PER LANE. A `single` run has one arm and this is exactly the fan-out it always had.
      // An `ab` run fans the SAME curated batch out to two lanes per repo — two worktrees, two
      // branches, two models, one `abPairKey` — so each arm rescans its OWN worktree and the same
      // guardbanded scorer adjudicates both. Neither arm ever grades the other.
      const arms = runLegs(run);
      const legs = activeTargets.flatMap((t) => arms.map((arm) => ({ t, arm })));
      const results = await mapPool(legs, run.concurrency * arms.length, async ({ t, arm }) => {
        if (state.stopRequested) return { repo: t.repo, progressed: false };
        // Keyed by arm as well as repo: two arms of one repo are two working copies, and sharing one
        // would have them commit over each other.
        const wtKey = arm.key ? `${t.repo}#${arm.key}` : t.repo;
        let wt = state.worktrees.get(wtKey);
        if (!wt) {
          try {
            // Same stamp for both arms: `createLoopWorktree` suffixes a name collision, so the two
            // branches are visibly siblings of one run rather than unrelated timestamps.
            wt = await createLoopWorktree(t.path, t.repo, stamp, branchFor, input.baseRef ?? "HEAD");
            state.worktrees.set(wtKey, wt);
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
        // The key the stop path names when a lane refuses to die — the same `<repo>[#arm]` the
        // worktree is keyed by, plus the cycle, so "which lane" is answerable from the run row alone.
        const laneKey = `${wtKey}#${cycle}`;
        const res = await runLane({
          runId: run.id,
          org: state.orgSlug,
          repo: t.repo,
          cycle,
          worktree: wt,
          // THE LANE DERIVES ITS OWN DEADLINE (from this run's parameters, which it already receives)
          // and hands the handle back here. The engine holds it only so a stop can force-fail a lane
          // that is inside a call which will not return; it never sets or shortens the deadline.
          onWatchdog: (watchdog) => state.lanes.set(laneKey, watchdog),
          // A practice lane answers exactly one row — the highest-impact gap its starter is for — so
          // it names that row as its batch and the trailer closes it, or the rescan declines to.
          batch: plan.kind === "practice" && plan.itemId ? [plan.itemId] : (batches[t.repo] ?? null),
          kind: plan.kind,
          practiceId: plan.practiceId,
          reason: plan.reason,
          deps: input.deps,
          // Every cycle of a run uses the run's configuration — read off the ROW rather than the
          // input, so a retry dispatched hours later cannot silently pick up a changed env. Under
          // `ab` the ARM's model overrides it; the effort is shared, because the arms are a model
          // comparison and a second varying factor would make the difference uninterpretable.
          agent: { model: arm.model ?? run.model, effort: run.effort, timeoutMs: run.agentTimeoutMs },
          // THE ARM ITSELF, when this run has one: the lane reads its executing transport and its
          // planning half off it, and records both on its row. Null on every pre-arms run, which is
          // the path that must stay byte-identical.
          arm: arm.arm,
          // Read off the ROW for the same reason the agent configuration is: a run's throughput and
          // its guard are part of what it IS, and a cycle dispatched hours later must not silently
          // pick up a changed default.
          batchSize: run.batchSize,
          verify: { enabled: verifyModeOf(run.verifyMode) === "on", timeoutMs: run.verifyTimeoutMs },
          abPairKey: arm.key ? abPairKeyFor(run.id, t.repo, cycle) : null,
          // WHEN THIS LANE RESCANS. Under `"run"` only the run's LAST cycle takes the reading; the
          // earlier ones hand their cycle back and the settle below adjudicates all of them against
          // it. The lane cannot decide this itself — whether a repo gets another cycle is this
          // loop's judgment (the drop-out rule), not the lane's.
          rescanCadence: cadence,
          finalCycle: cycle >= run.maxCycles,
          // THE STANDING RUNNER. Read off the ROW for planning (a property of what the run IS); the
          // runner-grade flags ride on the input, since only the drive that armed the run knows them.
          runner: {
            plan: run.planMode === "on",
            autoKeepLessons: input.runnerLane?.autoKeepLessons === true,
            installDeps: input.runnerLane?.installDeps === true,
          },
          // THE DRY-LANE PERMIT (see `DryLaneRefresh`). Only the driver can hand this over: it is the
          // only place that holds a pairing verified at arm time, the run's start, and the per-run
          // memo that keeps the refresh to one scan per repo. A lane WITH work never reads it.
          refresh: {
            pairedPath: t.path,
            runStartedAt: new Date(run.startedAt),
            claim: () => {
              if (state.refreshed.has(t.repo)) return false;
              state.refreshed.add(t.repo);
              return true;
            },
          },
          shouldStop: () => state.stopRequested,
        });
        // The lane is over (`runLane` never throws — every outcome, including a force-fail, comes
        // back as lane data), so its watchdog is no longer something a stop needs to bite.
        state.lanes.delete(laneKey);
        // ── THE DEFERRED READING, held or settled. A cycle that deferred joins the queue for this
        // worktree. ANY other outcome — it rescanned, it committed nothing, it failed — is the last
        // cycle this repo gets or the last one that could have read the tree, so the queue is
        // settled here: against this lane's own scan when it took one, and otherwise with the single
        // reading the earlier cycles' commits are owed. Under `"cycle"` neither branch ever runs.
        if (res.deferred) {
          pending.set(wtKey, [...(pending.get(wtKey) ?? []), res.deferred]);
        } else {
          const owed = pending.get(wtKey) ?? [];
          if (owed.length > 0) {
            pending.delete(wtKey);
            await settleDeferredCycles({
              runId: run.id,
              org: state.orgSlug,
              repo: t.repo,
              worktree: wt,
              deferred: owed,
              deps: input.deps,
              scan: res.scan ?? null,
            }).catch(() => undefined);
          }
        }
        // DELIVERY, after the cycle and never instead of it. Under `branch` (the default) this returns
        // without reading a thing, so the loop behaves exactly as it did before delivery existed.
        // Under `land`/`pr` a refusal is logged on the lane and the run carries on: the work is
        // already committed on the branch, and losing a whole cycle because a merge could not happen
        // would be the more expensive failure by far.
        // `laneId` is null when the lane never got a row at all (no database), which is also a lane
        // with no branch to deliver.
        if (res.laneId) {
          await deliverLane({
            delivery: run.delivery,
            // Same row, same reason as the retry path above: verified-only delivery is part of the
            // run's configuration.
            verifyMode: run.verifyMode,
            orgSlug: state.orgSlug,
            orgId: run.orgId,
            laneId: res.laneId,
            pairedPath: t.path,
            actor: run.createdBy,
          }).catch(() => null);
        }
        return { repo: t.repo, progressed: res.progressed };
      });
      // A repo survives to the next cycle when ANY of its arms progressed: dropping a repo because
      // one arm stalled would end the comparison on the strength of the weaker model.
      const kept = new Set(results.filter((r) => r.progressed).map((r) => r.repo));
      activeTargets = activeTargets.filter((t) => kept.has(t.repo));
    }
    // A run the stop backstop already wrote terminal keeps THAT row: it names the lanes that refused
    // to die, and a late-arriving "stopped" from here would erase the only record of them.
    if (!state.terminated) {
      await updateLoopRun(run.id, { phase: state.stopRequested ? "stopped" : "done", endedAt: new Date() });
    }
  } finally {
    // A run that ended — normally, stopped or in error — with cycles still owed a reading gives their
    // rows back rather than taking a five-minute scan on the way out. See `abandonDeferredCycles`.
    for (const owed of pending.values()) {
      await abandonDeferredCycles(owed, "the run ended before its closing rescan").catch(() => undefined);
    }
    pending.clear();
    clearStopTeeth(state);
    for (const wt of state.worktrees.values()) {
      forgetVerifyBaseline(wt.dir);
      await removeLoopWorktree(wt);
    }
    live.delete(run.id);
  }
}

/**
 * ONE LEG PER ARM, in whichever vocabulary this run was armed in.
 *
 * `key` is what makes two legs of one repo two different lanes: it keys the worktree, the watchdog
 * and the `abPairKey`. It is NULL for a run with one arm — an arm is not a comparison, and giving a
 * single-arm run a key would rename its worktree and its branch for no measurement at all.
 *
 * The legacy pair (`modelPolicy: "ab"` + two model names) is kept as its own branch rather than
 * rewritten into arms: an existing run must replay with the same worktree keys, the same branches and
 * the same pair key it had, and a translation layer is one off-by-one from silently not doing that.
 */
function runLegs(run: LoopRunRecord): { key: string | null; arm: Arm | null; model: string | null }[] {
  const armed = run.arms ?? [];
  if (armed.length > 0) {
    const compare = run.armPolicy === "compare" && armed.length > 1;
    return armed.map((arm) => ({ key: compare ? arm.id : null, arm, model: arm.model }));
  }
  if (run.modelPolicy === "ab" && run.models.length === 2) {
    return run.models.map((model) => ({ key: model, arm: null, model }));
  }
  return [{ key: null, arm: null, model: null }];
}

/**
 * The key joining the two arms of one A/B comparison.
 *
 * Derived, not random: `(run, repo, cycle)` is exactly what makes two lanes the same experiment, so
 * the key can be recomputed from the row rather than having to be carried through every path that
 * might retry or resume a lane.
 *
 * UNDER `compare` IT IS THE SAME KEY, joining N arms instead of two — the derivation never mentioned
 * the arm, which is why generalizing it needed no change here at all.
 */
export function abPairKeyFor(runId: string, repo: string, cycle: number): string {
  return `${runId}:${repo}:${cycle}`;
}

/** A worktree that could not be created is a lane error, not a run error. */
/**
 * Record the "already dispatched, not re-raising" lesson. Dynamically imported and swallowed whole:
 * a lesson is an explanation for a human, and failing to write one must never stop a run from arming.
 */
async function noteSkippedPractice(org: string, repo: string, practiceId: string): Promise<void> {
  try {
    const { ALL_PRACTICES } = await import("@/lib/practices");
    const label = ALL_PRACTICES.find((p) => p.id === practiceId)?.label ?? practiceId;
    const { recordPracticeSkipLesson } = await import("@/lib/db/loop-lessons");
    await recordPracticeSkipLesson(org, repo, practiceId, label);
  } catch {
    /* a missing explanation is never a reason to refuse the run */
  }
}

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
