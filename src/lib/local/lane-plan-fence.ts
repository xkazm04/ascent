// THE FENCE — did the REAL diff keep the plan's word? (spark theater-upgrade, 2026-09-18; WP3)
//
// A plan's declaration is a claim; the diff is the fact. After a plan-mode lane commits, its
// `before..HEAD` diff is measured against the module partition AS IT WAS AT `before` (read out of git,
// not off the working copy — the working copy already carries the moves being judged), and every
// architecture move it actually made must be either DECLARED by the executing plan (same kind, same
// modules — see `moveCovered`) or wholly inside the approved direction's fence.
//
// An undeclared move is HELD, never landed:
//   1. the cycle's commits are kept on `ascent/held/<planId ?? laneId>` — evidence for the reviewer,
//      and a ref the paired repository shares, so it outlives the throwaway worktree;
//   2. the lane branch is reset to `before` INSIDE THE THROWAWAY WORKTREE (refused outright when the
//      worktree path is the operator's own checkout, or the worktree is not on the lane's branch), so
//      the next cycle does not build on held work;
//   3. the executing plan becomes `held`, and a NEW `pending` major plan (`undeclared-moves-in-diff`)
//      re-asks for the same items, naming the moves the diff made and the held branch.
// FAIL CLOSED: a diff the check cannot read is a diff it cannot vouch for, so it is held too.
// Every db access is a LAZY import (see lane-plan.ts).

import { resolve } from "node:path";
import type { LoopWorktree } from "@/lib/local/loop-worktree";
import { runGit } from "@/lib/local/git";
import { movesInDiff, parseNameStatus, partitionFromTree } from "@/lib/local/module-partition";
import { describeMove, undeclaredMoves } from "@/lib/local/lane-plan-classify";
import type { ArchitectureMove } from "@/lib/local/runner-types";

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

/** The held-branch prefix. One branch per held plan (or lane, when no plan row exists). */
export const HELD_BRANCH_PREFIX = "ascent/held/";

const safeRef = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[-.]+/, "").slice(0, 80) || "lane";

/** Park HEAD on the held branch and reset the lane branch to `before` — in the throwaway worktree only. */
async function parkCommits(worktree: LoopWorktree, before: string, id: string): Promise<{ branch: string | null; note: string | null }> {
  if (!worktree.dir || resolve(worktree.dir) === resolve(worktree.pairedPath)) {
    return { branch: null, note: "the lane's worktree path is the operator's own checkout, so nothing was moved or reset" };
  }
  const head = await runGit(worktree.dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!head.ok || head.stdout.trim() !== worktree.branch) {
    return { branch: null, note: `the worktree is not on the lane branch ${worktree.branch}, so nothing was moved or reset` };
  }
  let branch = `${HELD_BRANCH_PREFIX}${safeRef(id)}`;
  let made = await runGit(worktree.dir, ["branch", branch, "HEAD"]);
  if (!made.ok) {
    branch = `${branch}-${Date.now().toString(36)}`;
    made = await runGit(worktree.dir, ["branch", branch, "HEAD"]);
  }
  if (!made.ok) return { branch: null, note: `the held branch could not be created (${made.stderr.trim().slice(0, 200)}), so the lane branch was NOT reset` };
  const reset = await runGit(worktree.dir, ["reset", "--hard", before]);
  if (!reset.ok) return { branch, note: `the lane branch could NOT be reset to ${before.slice(0, 12)} (${reset.stderr.trim().slice(0, 200)})` };
  return { branch, note: null };
}

/**
 * Settle an executing plan `landed`. The fence calls it on a clean check; a lane that ADOPTED an
 * approved plan's held commits (lane-adopt.ts) calls it in the fence's place, because the diff the
 * operator reviewed IS the declaration. Never throws.
 */
export async function settleLandedPlan(planId: string | null): Promise<void> {
  if (!planId) return;
  try {
    const { settleExecutingPlan } = await import("@/lib/db/loop-plans-write");
    await settleExecutingPlan(planId, "landed");
  } catch {
    /* the ledger row stays `executing`; the landing itself is unaffected */
  }
}

export async function checkPlanFence(input: PlanFenceInput): Promise<PlanFenceVerdict> {
  const dir = input.worktree.dir;
  const diff = await runGit(dir, ["-c", "core.quotepath=off", "diff", "--name-status", "-z", "-M", `${input.before}..HEAD`]);
  const listed = await runGit(dir, ["-c", "core.quotepath=off", "ls-tree", "-r", "-z", "--name-only", input.before]);
  let undeclared: ArchitectureMove[] = [];
  let unreadable: string | null = null;
  if (!diff.ok || !listed.ok) {
    unreadable = (diff.ok ? listed.stderr : diff.stderr).trim().slice(0, 200) || "git gave no reason";
  } else {
    const trackedBefore = listed.stdout.split("\0").filter(Boolean);
    const partition = await partitionFromTree(trackedBefore, async (p) => {
      const shown = await runGit(dir, ["show", `${input.before}:${p}`]);
      return shown.ok ? shown.stdout : null;
    });
    const actual = movesInDiff(parseNameStatus(diff.stdout), partition, trackedBefore);
    undeclared = undeclaredMoves(actual, input.declaredMoves, input.directionFence, partition);
    if (undeclared.length === 0) {
      await settleLandedPlan(input.planId);
      return { verdict: "land" };
    }
  }

  const parked = await parkCommits(input.worktree, input.before, input.planId ?? input.laneId);
  const what = unreadable
    ? `The fence check could not read this cycle's diff (${unreadable}), so it cannot vouch that the plan's word was kept — the work is held, not landed.`
    : `This cycle's diff made architecture move(s) its plan did not declare: ${undeclared.map(describeMove).join("; ")}.`;
  const where = parked.branch
    ? ` The commits are kept on \`${parked.branch}\` for review${parked.note ? `, but ${parked.note}` : " and the lane branch was reset"}; the items now wait as a plan for the operator.`
    : ` ${parked.note ?? "Nothing was moved."}; the items now wait as a plan for the operator.`;
  const reason = `Held — ${what}${where}`;
  if (input.planId) {
    try {
      const { holdExecutingPlan } = await import("@/lib/db/loop-plans-write");
      await holdExecutingPlan({ planId: input.planId, heldBranch: parked.branch, explanation: reason });
    } catch {
      /* the verdict stands: an unrecorded hold is still not a landing */
    }
  }
  return { verdict: "held", reason, heldBranch: parked.branch };
}
