// LOOP PLANS — the ENGINE's writes (spark theater-upgrade, 2026-09-18; WP3). The operator's decisions
// are in loop-plan-decide.ts; the reads and the row mapper are in loop-plans.ts.
//
// Every status move here is CONDITIONAL on the status it moves from (`updateMany where status = …`),
// so two writers racing on one plan — two lanes picking the same approved plan, a decision landing
// while the engine settles — resolve to exactly one winner instead of a last-write-wins overwrite.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { orgIdForSlug } from "@/lib/db/loop-tenancy";
import { chargeDirectionCycleIn } from "@/lib/db/loop-directions";
import { toPlanRecord } from "@/lib/db/loop-plans";
import { parseStringArray } from "@/lib/db/json-columns";
import type { LanePlan, LoopPlanRecord, ModulePartition, PlanClass, PlanClassReason, PlanStatus } from "@/lib/local/runner-types";

/** The planner's prose is kept for the reviewer, bounded — a runaway session is not a document. */
export const PLAN_TEXT_MAX = 100_000;
const capText = (t: string) => (t.length > PLAN_TEXT_MAX ? `${t.slice(0, PLAN_TEXT_MAX)}\n…[truncated at ${PLAN_TEXT_MAX} chars]` : t);

/** One persisted slice of a lane plan: its items (aligned keys, ids and titles) and its class. */
export interface PlanSlice {
  plan: LanePlan | null;
  keys: string[];
  recIds: string[];
  /** The items' titles as they read now — the only human-readable name a durable key keeps. */
  titles: string[];
  cls: PlanClass;
  clsReason: PlanClassReason;
  directionId: string | null;
}

export interface RecordLanePlansInput {
  org: string;
  repo: string;
  runId: string;
  laneId: string;
  sessionId: string;
  planText: string;
  partition: ModulePartition;
  /** The items that execute now (status `executing`), or null. */
  executing: PlanSlice | null;
  /** The items parked for the operator (status `pending`), or null. */
  parked: PlanSlice | null;
  /** Earlier `revise` plans on these items, now answered by this plan. */
  supersede: string[];
}

/**
 * Persist one lane's plan as at most TWO rows — the executing slice and the parked slice — mark the
 * `revise` plans it answers `superseded`, and charge one cycle to the direction the executing slice
 * runs under. One transaction: a plan that is half-recorded is a plan whose parked items nobody holds.
 * Throws when the org is unknown or a write fails; the caller turns that into a failed lane.
 */
export async function recordLanePlans(input: RecordLanePlansInput): Promise<{ executingId: string | null; parkedId: string | null }> {
  const orgId = await orgIdForSlug(input.org);
  if (!orgId) throw new Error(`Unknown organization ${input.org}.`);
  const base = {
    orgId,
    repo: input.repo,
    runId: input.runId,
    laneId: input.laneId,
    planText: capText(input.planText),
    partitionJson: JSON.stringify(input.partition),
    sessionId: input.sessionId,
  };
  const rowOf = (slice: PlanSlice, status: PlanStatus) => ({
    ...base,
    directionId: slice.directionId,
    itemKeysJson: JSON.stringify(slice.keys),
    recIdsJson: JSON.stringify(slice.recIds),
    itemTitlesJson: JSON.stringify(slice.titles),
    planJson: slice.plan ? JSON.stringify(slice.plan) : "{}",
    cls: slice.cls,
    clsReason: slice.clsReason,
    status,
  });
  return getPrisma().$transaction(async (tx) => {
    const executing = input.executing ? await tx.loopPlan.create({ data: rowOf(input.executing, "executing"), select: { id: true } }) : null;
    const parked = input.parked ? await tx.loopPlan.create({ data: rowOf(input.parked, "pending"), select: { id: true } }) : null;
    if (input.supersede.length) {
      await tx.loopPlan.updateMany({ where: { id: { in: input.supersede }, orgId, status: "revise" }, data: { status: "superseded" } });
    }
    if (input.executing?.directionId) await chargeDirectionCycleIn(tx, input.executing.directionId);
    return { executingId: executing?.id ?? null, parkedId: parked?.id ?? null };
  });
}

/** Earlier plans on these items that the operator sent back (`revise`), with the note, oldest first. */
export async function reviseNotesFor(
  orgSlug: string,
  repo: string,
  keys: readonly string[],
): Promise<{ id: string; intent: string; note: string; decidedBy: string | null }[]> {
  if (!isDbConfigured() || keys.length === 0) return [];
  const orgId = await orgIdForSlug(orgSlug);
  if (!orgId) return [];
  const want = new Set(keys);
  const rows = await getPrisma().loopPlan.findMany({ where: { orgId, repo, status: "revise" }, orderBy: { createdAt: "asc" }, take: 50 });
  return rows
    .map(toPlanRecord)
    .filter((p) => p.itemKeys.some((k) => want.has(k)))
    .map((p) => ({ id: p.id, intent: p.plan?.intent ?? p.planText.split("\n")[0]!.slice(0, 300), note: p.decisionNote ?? "", decidedBy: p.decidedBy }));
}

/** Conditional status move. True when this call moved the row. */
async function move(id: string, from: readonly PlanStatus[], data: { status: PlanStatus } & Record<string, unknown>): Promise<boolean> {
  const res = await getPrisma().loopPlan.updateMany({ where: { id, status: { in: [...from] } }, data });
  return res.count === 1;
}

/** An executing plan's lane landed (or failed) — the end of the proposals ledger's row. */
export async function settleExecutingPlan(id: string, status: "landed" | "failed"): Promise<boolean> {
  if (!isDbConfigured() || !id) return false;
  return move(id, ["executing"], { status });
}

/** Pick an approved plan for execution: approved → executing, narrowed to the items that still
 *  resolve (today's row ids; the titles as they read when the plan was written, kept aligned), and
 *  charge its direction a cycle. False when another writer got there first (no longer approved). */
export async function startDirectedPlan(
  id: string,
  directionId: string,
  recIds: readonly string[],
  keys: readonly string[],
  titles: readonly string[],
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  return getPrisma().$transaction(async (tx) => {
    const res = await tx.loopPlan.updateMany({
      where: { id, status: "approved" },
      data: { status: "executing", recIdsJson: JSON.stringify(recIds), itemKeysJson: JSON.stringify(keys), itemTitlesJson: JSON.stringify(titles) },
    });
    if (res.count !== 1) return false;
    await chargeDirectionCycleIn(tx, directionId);
    return true;
  });
}

/** An approved plan nothing is left to execute (none of its items is open any more). */
export async function supersedeApprovedPlan(id: string, note: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  return move(id, ["approved"], { status: "superseded", decisionNote: note });
}

/** An approved plan whose direction is gone: back to the operator, never executed on a dead grant. */
export async function returnApprovedPlan(id: string, note: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  return move(id, ["approved"], { status: "pending", decidedBy: null, decidedAt: null, decisionNote: note });
}

/**
 * THE FENCE HELD A LANE. The executing plan becomes `held` with the branch its commits were parked
 * on, and a NEW `pending` major plan re-asks for the same items — `undeclared-moves-in-diff`, with the
 * moves the diff actually made at the top of its text and the held branch as evidence. One transaction.
 */
export async function holdExecutingPlan(input: {
  planId: string;
  heldBranch: string | null;
  /** Which moves the diff made and where the commits went — the reviewer's first paragraph. */
  explanation: string;
}): Promise<LoopPlanRecord | null> {
  if (!isDbConfigured()) return null;
  return getPrisma().$transaction(async (tx) => {
    const row = await tx.loopPlan.findUnique({ where: { id: input.planId } });
    if (!row) return null;
    await tx.loopPlan.updateMany({ where: { id: row.id, status: "executing" }, data: { status: "held", heldBranch: input.heldBranch } });
    const created = await tx.loopPlan.create({
      data: {
        orgId: row.orgId,
        repo: row.repo,
        runId: row.runId,
        laneId: row.laneId,
        directionId: null,
        itemKeysJson: JSON.stringify(parseStringArray(row.itemKeysJson) ?? []),
        recIdsJson: JSON.stringify(parseStringArray(row.recIdsJson) ?? []),
        itemTitlesJson: JSON.stringify(parseStringArray(row.itemTitlesJson) ?? []),
        planJson: row.planJson,
        planText: capText(`${input.explanation}\n\n--- the plan the lane executed ---\n${row.planText}`),
        partitionJson: row.partitionJson,
        cls: "major",
        clsReason: "undeclared-moves-in-diff",
        status: "pending",
        sessionId: row.sessionId,
        heldBranch: input.heldBranch,
      },
    });
    return toPlanRecord(created);
  });
}
