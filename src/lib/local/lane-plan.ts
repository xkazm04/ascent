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
// Registry: `hitl-approval/fixed-policy-amendable-plan`, `plan-review/objection-before-artifacts`.

import type { FollowUpItem } from "@/lib/org/followups";
import type { LoopWorktree } from "@/lib/local/loop-worktree";
import type { AgentRunResult, ClaudeAgentOptions } from "@/lib/local/agent";
import type { AgentStreamEvent, ArchitectureMove, LanePlan, ModulePartition, PlanClass, PlanClassReason } from "@/lib/local/runner-types";

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
  /** The lane's activity sink — the planning session streams into the same tail the theater reads. */
  onEvent?: (e: AgentStreamEvent) => void;
  /** The watchdog's cut. */
  signal?: AbortSignal;
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
    };

/** Plan the lane's batch. STUB (WP0): returns `skip`, which is byte-identical to a lane before planning. */
export async function planLane(_input: PlanLaneInput): Promise<PlanLaneOutcome> {
  return { mode: "skip" };
}

export interface PlanFenceInput {
  org: string;
  repo: string;
  laneId: string;
  worktree: LoopWorktree;
  /** The worktree HEAD before this cycle's session — the diff is `before..HEAD`. */
  before: string;
  planId: string | null;
  declaredMoves: ArchitectureMove[];
  directionFence: string[] | null;
}

export type PlanFenceVerdict =
  | { verdict: "land" }
  /** The diff made an architecture move the plan did not declare. The implementation has ALREADY moved
   *  the cycle's commits to `heldBranch` (evidence for the reviewer) and reset the lane branch to
   *  `before`, so the next cycle does not build on held work. */
  | { verdict: "held"; reason: string; heldBranch: string | null };

/** STUB (WP0): every diff lands, as before. */
export async function checkPlanFence(_input: PlanFenceInput): Promise<PlanFenceVerdict> {
  return { verdict: "land" };
}

/** An APPROVED major plan whose items are due to execute, re-resolved to today's recommendation ids. */
export interface DirectedBatch {
  planId: string;
  directionId: string;
  items: FollowUpItem[];
  /** The approved plan, as the execution session's fixed tier. Executed in a FRESH session. */
  planBlock: string;
  directionFence: string[];
  declaredMoves: ArchitectureMove[];
}

/** The next approved plan to execute on this repo, or null. STUB (WP0): none. */
export async function nextDirectedBatch(_org: string, _repo: string): Promise<DirectedBatch | null> {
  return null;
}

/** Parse the ONE fenced ```json block of a planning session's final message. Null = unreadable. */
export function parsePlan(_text: string): LanePlan | null {
  return null;
}

/** Classify a parsed plan (null = unreadable → major). STUB (WP0). */
export function classifyPlan(
  plan: LanePlan | null,
  _partition: ModulePartition | null,
  _activeFences: readonly string[][] = [],
): { cls: PlanClass; reason: PlanClassReason } {
  return plan ? { cls: "minor", reason: "no-moves" } : { cls: "major", reason: "unreadable" };
}
