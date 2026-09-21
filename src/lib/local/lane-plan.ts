// PLAN FIRST — the read-only planning session a plan-mode lane opens with, the classifier that decides
// which of its items wait for a human, and the post-hoc check that the real diff kept the plan's word
// (spark theater-upgrade, 2026-09-18; WP3 implements, the signatures below are the contract).
//
// THE RULE, as the operator set it: only an ARCHITECTURE MOVE waits (a module created, removed, split or
// merged, or code moved across module boundaries — see `ArchitectureMoveKind`). Contract, dependency and
// footprint changes are auto-approved, because they land on the runner branch and merging that branch is
// itself the human gate. Two invariants hold regardless:
//   • a plan the engine cannot read is MAJOR (`clsReason: "unreadable"`) — the loud default;
//   • the REAL diff is checked after execution (`checkPlanFence`): an architecture move the plan did not
//     declare is not landed, and its plan re-queues as major (`undeclared-moves-in-diff`).
//
// THE PLANNING SESSION IS TOOL POLICY, NOT A SANDBOX. `--permission-mode plan` and a Read/Grep/Glob
// allowlist are what the CLI offers; neither is an OS boundary, so after the session the implementation
// MUST prove the worktree is untouched (`git status --porcelain` empty) and fail the lane when it is not
// (`hitl-approval`: a gate the gated party can open is a decoration).
//
// This file is the entry point and the planning session itself. The pieces, co-located:
//   lane-plan-parse.ts    — the plan contract's strict reader;
//   lane-plan-classify.ts — the per-item split and the declared-vs-actual move comparison;
//   lane-plan-prompt.ts   — the planner's brief and the executor's fixed-tier block;
//   lane-plan-fence.ts    — `checkPlanFence`; lane-plan-directed.ts — `nextDirectedBatch`.
// EVERY db access below is a LAZY import: loop-lane.ts imports this module, and its unit tests mock the
// db barrels — importing lane-plan.ts must never pull Prisma.
//
// Registry: `hitl-approval/fixed-policy-amendable-plan`, `plan-review/objection-before-artifacts`.

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { FollowUpItem } from "@/lib/org/followups";
import type { LoopWorktree } from "@/lib/local/loop-worktree";
import type { AgentRunResult, ClaudeAgentOptions } from "@/lib/local/agent";
import { runGit } from "@/lib/local/git";
import { modulePartition } from "@/lib/local/module-partition";
import { parsePlan } from "@/lib/local/lane-plan-parse";
import { splitPlan, type DirectionGrant, type ItemClass } from "@/lib/local/lane-plan-classify";
import { buildPlanBlock, buildPlanningPrompt, type ReviseNote } from "@/lib/local/lane-plan-prompt";
import { isSplitArm, planArmOf, type Arm, type TransportId } from "@/lib/local/arm";
import type { TransportRunOptions } from "@/lib/local/transport/run";
import { recommendationDecisionKey } from "@/lib/report/rec-identity";
import {
  PLAN_TIMEOUT_MS,
  type AgentStreamEvent,
  type ArchitectureMove,
  type LanePlan,
  type ModulePartition,
  type PlanClassReason,
} from "@/lib/local/runner-types";

export { parsePlan } from "@/lib/local/lane-plan-parse";
export { classifyPlan } from "@/lib/local/lane-plan-classify";
export { checkPlanFence, type PlanFenceInput, type PlanFenceVerdict } from "@/lib/local/lane-plan-fence";
export { nextDirectedBatch, type DirectedBatch } from "@/lib/local/lane-plan-directed";

export interface PlanLaneInput {
  org: string;
  repo: string;
  runId: string;
  laneId: string;
  cycle: number;
  worktree: LoopWorktree;
  /** The batch this lane won the claim on. The plan covers every item; the classifier splits it. */
  batch: FollowUpItem[];
  /** The org's standard for this batch — the SAME brief text the execution session will be given. */
  briefText: string | null;
  agent: { model?: string | null; effort?: string | null };
  /** The runner seam (`LaneDeps.runAgent`), so a test never spawns a process. */
  runAgent: (opts: ClaudeAgentOptions) => Promise<AgentRunResult>;
  /**
   * THE ARM THIS LANE IS RUNNING, when the run has one. Its PLANNING half is what this session is
   * spawned as (`planArmOf`) — which is the whole point of the arm shape: "Claude plans, a local
   * model executes" is two transports in one lane, and it is unreachable if the planning session can
   * only read the executing model off `agent`.
   *
   * Null (every run armed before arms existed) leaves this function byte-identical: it spawns through
   * `runAgent` with `agent.model`, exactly as it always did.
   */
  arm?: Arm | null;
  /** Transport-aware dispatch. Consulted ONLY when `arm` is present; absent means the pre-arms path,
   *  so a caller that never heard of transports cannot accidentally take the new one. */
  runVia?: (transport: TransportId, opts: TransportRunOptions) => Promise<AgentRunResult>;
  /** The lane's activity sink — the planning session streams into the same tail the theater reads. */
  onEvent?: (e: AgentStreamEvent) => void;
  /** The watchdog's cut. */
  signal?: AbortSignal;
  /** THIS ARM'S planning ceiling. Omitted = `PLAN_TIMEOUT_MS`, the shared constant every lane used
   *  before transports had their own timing bands — a 27B at Q4 generates at roughly a tenth of a
   *  hosted model's rate, and one ceiling for both forces a choice between failing every local lane on
   *  the clock and removing the tripwire that catches a stuck Claude one. */
  planTimeoutMs?: number | null;
}

export type PlanLaneOutcome =
  /** Planning did not happen (the stub, or a run with plan mode off) — the lane proceeds as before. */
  | { mode: "skip" }
  /** No plan was produced at all (the session failed, timed out, or wrote to the worktree). A lane
   *  failure: the lane's claims are released and the runner counts it toward the repo's failure streak. */
  | { mode: "failed"; message: string }
  | {
      mode: "execute";
      /** The persisted `LoopPlan` row for the items that execute now, or null when nothing persisted. */
      planId: string | null;
      /** Items whose plan declares no architecture move (or stays inside an active direction's fence). */
      execute: FollowUpItem[];
      /** Items split off into ONE pending major plan. Their claims are released by the lane; their
       *  durable keys keep them out of `openBatch` until the operator decides. */
      parked: FollowUpItem[];
      /** The plan text the EXECUTION session is given, fenced as its fixed tier. */
      planBlock: string;
      /** The planning session's id — the minor execution resumes it (context already loaded). */
      resumeSessionId: string | null;
      /** What the executing plan DECLARED, for the post-hoc fence check. */
      declaredMoves: ArchitectureMove[];
      /** When the executing items run under an approved direction, that direction's fence. */
      directionFence: string[] | null;
      /** THE MODEL THAT PLANNED — what the lane row's `planModel` records. Null when nothing named
       *  one (the deployment default answered), which is an absence and never a guess. */
      planModel: string | null;
    };

export const PLAN_WROTE_MESSAGE =
  "The planning session wrote to the worktree — its read-only policy did not hold; nothing was executed.";

/** `git status --porcelain` lines, or null when git could not answer (which proves nothing). */
async function porcelain(dir: string): Promise<string[] | null> {
  const res = await runGit(dir, ["status", "--porcelain"]);
  return res.ok ? res.stdout.split("\n").filter((l) => l.trim()) : null;
}

/** The worktree's HEAD sha, or null. A session that COMMITS leaves a clean tree and a moved HEAD. */
async function headOf(dir: string): Promise<string | null> {
  const res = await runGit(dir, ["rev-parse", "HEAD"]);
  return res.ok ? res.stdout.trim() : null;
}

/** Put a THROWAWAY lane worktree back to `head` (and its files to it). Refuses to touch the
 *  operator's own checkout — the one directory this must never reset. */
async function restoreWorktree(worktree: LoopWorktree, head: string | null): Promise<void> {
  if (!worktree.dir || resolve(worktree.dir) === resolve(worktree.pairedPath)) return;
  if (head) await runGit(worktree.dir, ["reset", "--hard", head]);
  await runGit(worktree.dir, ["checkout", "--", "."]);
  await runGit(worktree.dir, ["clean", "-fd"]);
}

const firstLine = (s: string) => (s.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 300) || "no output";

/** A plan restricted to one slice's items — each persisted row carries only the items it holds. */
function sliceOf(plan: LanePlan | null, ids: ReadonlySet<string>): LanePlan | null {
  return plan ? { ...plan, items: plan.items.filter((i) => ids.has(i.recommendationId)) } : null;
}

async function loadDirections(org: string, repo: string): Promise<DirectionGrant[]> {
  try {
    const { activeDirections } = await import("@/lib/db/loop-directions");
    return (await activeDirections(org, repo)).map((d) => ({ id: d.id, fence: d.fence }));
  } catch {
    return []; // no grant is ever assumed: without directions, every item with a move is parked
  }
}

async function loadRevise(org: string, repo: string, keys: string[]): Promise<{ id: string; note: ReviseNote }[]> {
  try {
    const { reviseNotesFor } = await import("@/lib/db/loop-plans-write");
    return (await reviseNotesFor(org, repo, keys)).map((r) => ({ id: r.id, note: { intent: r.intent, note: r.note, decidedBy: r.decidedBy } }));
  } catch {
    return [];
  }
}

/** Plan the lane's batch: one read-only session, one classified split, at most two persisted rows. */
export async function planLane(input: PlanLaneInput): Promise<PlanLaneOutcome> {
  const { worktree, batch, org, repo } = input;
  if (batch.length === 0) return { mode: "skip" };
  const keyOf = (it: FollowUpItem) => recommendationDecisionKey(repo, it.dimId ?? "", it.title);
  const partition: ModulePartition = await modulePartition(worktree.dir).catch(() => ({ source: "directory", modules: [] }));
  const revise = await loadRevise(org, repo, batch.map(keyOf));
  const before = await porcelain(worktree.dir);
  const headBefore = await headOf(worktree.dir);
  const sessionId = randomUUID();
  // THE PLANNING HALF OF THE ARM. `planArmOf` returns the executing half when the arm declares no
  // separate planner, so an unsplit arm plans with exactly what it executes with — which is what
  // every lane before arms existed did, written down rather than assumed.
  const planArm = input.arm ? planArmOf(input.arm) : null;
  const planModel = planArm?.model ?? input.agent.model ?? null;
  const opts: TransportRunOptions = {
    cwd: worktree.dir,
    prompt: buildPlanningPrompt({ org, repo, batch, briefText: input.briefText, partition, revise: revise.map((r) => r.note) }),
    permission: "plan",
    sessionId,
    ...(planModel ? { model: planModel } : {}),
    ...(input.agent.effort ? { effort: input.agent.effort } : {}),
    timeoutMs: input.planTimeoutMs ?? PLAN_TIMEOUT_MS,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
  };
  const result = planArm && input.runVia ? await input.runVia(planArm.transport, opts) : await input.runAgent(opts);

  // THE CLEAN-TREE PROOF. The policy said read-only; only the tree can say whether it held — its
  // files (`git status --porcelain` empty) AND its history (HEAD where it was: a commit leaves a
  // clean tree behind it).
  const after = await porcelain(worktree.dir);
  const headAfter = await headOf(worktree.dir);
  if (after === null || after.length > 0 || headAfter !== headBefore) {
    await restoreWorktree(worktree, headBefore);
    if (after === null) return { mode: "failed", message: "The worktree could not be inspected after the planning session, so its read-only policy is unproven; nothing was executed." };
    if (before && before.length > 0) {
      return { mode: "failed", message: `The worktree was not clean before planning (${before.length} path(s) left by an earlier cycle), so the planning session's read-only policy could not be proven; nothing was executed.` };
    }
    return { mode: "failed", message: PLAN_WROTE_MESSAGE };
  }

  const text = result.summary ?? "";
  const plan = parsePlan(text);
  if (!result.ok && !plan) return { mode: "failed", message: `The planning session failed: ${firstLine(result.errorText || text)}` };

  const directions = await loadDirections(org, repo);
  const split = splitPlan(plan, partition, directions, batch.map((b) => b.id));
  const byId = new Map(split.items.map((c) => [c.recommendationId, c]));
  const runsNow = (c: ItemClass | undefined) => c != null && c.cls !== "major";
  const execute = batch.filter((it) => runsNow(byId.get(it.id)));
  const parked = batch.filter((it) => !runsNow(byId.get(it.id)));
  const underDirection = execute.some((it) => byId.get(it.id)?.cls === "minor-under-direction");
  const parkedReason: PlanClassReason = plan ? "declared-moves" : "unreadable";
  const slice = (items: FollowUpItem[]) => ({
    keys: items.map(keyOf),
    recIds: items.map((i) => i.id),
    titles: items.map((i) => i.title),
    plan: sliceOf(plan, new Set(items.map((i) => i.id))),
  });

  let ids: { executingId: string | null; parkedId: string | null };
  try {
    const { recordLanePlans } = await import("@/lib/db/loop-plans-write");
    ids = await recordLanePlans({
      org,
      repo,
      runId: input.runId,
      laneId: input.laneId,
      sessionId,
      planText: text,
      partition,
      executing: execute.length
        ? { ...slice(execute), cls: underDirection ? "minor-under-direction" : "minor", clsReason: underDirection ? "inside-direction-fence" : "no-moves", directionId: underDirection ? (split.direction?.id ?? null) : null }
        : null,
      parked: parked.length ? { ...slice(parked), cls: "major", clsReason: parkedReason, directionId: null } : null,
      supersede: revise.map((r) => r.id),
    });
  } catch (err) {
    // A plan nobody recorded is a parked item nobody holds: fail loudly rather than run unrecorded.
    return { mode: "failed", message: `The plan could not be recorded (${err instanceof Error ? err.message : String(err)}); nothing was executed.` };
  }

  const planned = execute.map((item) => ({ item, entry: byId.get(item.id)?.entry ?? null, moves: byId.get(item.id)?.moves ?? [] }));
  const directionFence = underDirection && split.direction ? [...split.direction.fence] : null;
  return {
    mode: "execute",
    planId: ids.executingId,
    execute,
    parked,
    planBlock: buildPlanBlock({ plan, items: planned, directionFence, directed: false }),
    // A SPLIT ARM CANNOT RESUME ITS OWN PLAN. The resume is an optimization — the execution session
    // continues the planning session, whose context is already loaded — and it is only available when
    // the SAME tool holds that session. When Claude planned and a local transport executes, the
    // session id names a conversation the executor has never heard of, so the plan travels as the
    // fenced `planBlock` in the prompt (which it always does anyway) and nothing is resumed.
    resumeSessionId: plan && result.ok && !(input.arm && isSplitArm(input.arm)) ? sessionId : null,
    declaredMoves: planned.flatMap((p) => p.moves),
    directionFence,
    planModel,
  };
}

// ── two settle-up seams for the lane (the Director wires them into loop-lane.ts) ────────────────

/**
 * An executing plan whose lane ended WITHOUT reaching the fence check — it committed nothing, failed,
 * or was stopped. `checkPlanFence` settles the lanes that commit; without this the proposals ledger
 * would show every other executed plan as `executing` forever. `landed` is not offered: nothing that
 * did not pass the fence may say it landed. Never throws.
 */
export async function settleLanePlan(planId: string | null): Promise<void> {
  if (!planId) return;
  try {
    const { settleExecutingPlan } = await import("@/lib/db/loop-plans-write");
    await settleExecutingPlan(planId, "failed");
  } catch {
    /* a ledger row left `executing` is a display gap, never a reason to fail the lane */
  }
}

/**
 * Charge a lane's metered cost (MICRO-CENTS) to the direction its plan ran under, when it ran under
 * one — the half of a direction's budget `usedCycles` cannot measure. Never throws.
 */
export async function chargeLanePlanCost(planId: string | null, costMicros: number | null | undefined): Promise<void> {
  if (!planId || costMicros == null || costMicros <= 0) return;
  try {
    const { getLoopPlan } = await import("@/lib/db/loop-plans");
    const plan = await getLoopPlan(planId);
    if (!plan?.directionId) return;
    const { chargeDirectionMicros } = await import("@/lib/db/loop-directions");
    await chargeDirectionMicros(plan.directionId, costMicros);
  } catch {
    /* an uncharged cost under-counts the budget; the cycle budget still bounds the direction */
  }
}
