// LOOP DIRECTIONS — the fenced, budgeted grants approving a major plan creates
// (spark theater-upgrade, 2026-09-18; WP3).
//
// A direction is the honest form of "stop asking me about this": an explicit, scoped, BUDGETED grant
// (`hitl-approval/unattended-mode`). Later plans whose architecture moves stay inside its fence run
// under it without asking, one cycle of budget each; the grant never widens itself.
//
// LIFECYCLE. `active` → `exhausted` (its cycle or cost budget is spent — the engine does this),
// `done` (the operator says the direction is complete) or `revoked` (the operator withdraws it). An
// ended direction never runs anything again, and its APPROVED-but-unexecuted plans are never left
// dangling or silently executed:
//   • exhausted / revoked → those plans return to `pending` (they wait for re-approval — a grant
//     that ran out, or was withdrawn, is not a grant for the work it had not reached yet);
//   • done → those plans are `superseded` (the operator declared the direction finished; their items
//     return to the ordinary backlog and are planned afresh).
// The cost budget (`budgetMicros`, MICRO-CENTS — 1e8 per USD, so the columns are BigInt) is charged by
// `chargeDirectionMicros`, which the engine calls with a lane's metered cost; `usedCycles` is charged
// when a plan starts under it. The WIRE record carries plain numbers (`toDirectionRecord` converts):
// a JSON body cannot carry a bigint, and a Number is exact far past any budget a direction will hold.

import type { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { parseStringArray } from "@/lib/db/json-columns";
import { orgIdForSlug } from "@/lib/db/loop-tenancy";
import type { DirectionStatus, LoopDirectionRecord } from "@/lib/local/runner-types";

const STATUSES: readonly DirectionStatus[] = ["active", "done", "exhausted", "revoked"];
export const isDirectionStatus = (v: unknown): v is DirectionStatus => typeof v === "string" && (STATUSES as readonly string[]).includes(v);

export interface LoopDirectionRow {
  id: string;
  orgId: string;
  repo: string;
  title: string;
  fenceJson: string;
  checkText: string;
  budgetCycles: number;
  budgetMicros: bigint | number | null;
  usedCycles: number;
  usedMicros: bigint | number;
  status: string;
  originPlanId: string;
  approvedBy: string | null;
  approvedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  endedAt: Date | null;
}

export function toDirectionRecord(row: LoopDirectionRow): LoopDirectionRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    repo: row.repo,
    title: row.title,
    fence: parseStringArray(row.fenceJson) ?? [],
    checkText: row.checkText,
    budgetCycles: row.budgetCycles,
    budgetMicros: row.budgetMicros == null ? null : Number(row.budgetMicros),
    usedCycles: row.usedCycles,
    usedMicros: Number(row.usedMicros),
    status: isDirectionStatus(row.status) ? row.status : "revoked",
    originPlanId: row.originPlanId,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
  };
}

/** Budget left: a cycle to spend, and (when a cost budget is set) money under it. */
export function directionHasBudget(d: Pick<LoopDirectionRecord, "budgetCycles" | "usedCycles" | "budgetMicros" | "usedMicros">): boolean {
  return d.usedCycles < d.budgetCycles && (d.budgetMicros == null || d.usedMicros < d.budgetMicros);
}

/** An org's directions, newest first, optionally by status (and repo). */
export async function listLoopDirections(
  orgSlug: string,
  opts: { status?: DirectionStatus[]; repo?: string } = {},
): Promise<LoopDirectionRecord[]> {
  if (!isDbConfigured()) return [];
  const orgId = await orgIdForSlug(orgSlug);
  if (!orgId) return [];
  const rows = await getPrisma().loopDirection.findMany({
    where: { orgId, ...(opts.repo ? { repo: opts.repo } : {}), ...(opts.status?.length ? { status: { in: opts.status } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(toDirectionRecord);
}

/** This repo's ACTIVE directions that still have budget, OLDEST first (the classifier's tie order). */
export async function activeDirections(orgSlug: string, repoFullName: string): Promise<LoopDirectionRecord[]> {
  const all = await listLoopDirections(orgSlug, { status: ["active"], repo: repoFullName });
  return all.filter(directionHasBudget).reverse();
}

/** The ACTIVE directions' fences for one repo — what a later plan's moves are checked against. */
export async function activeFences(orgSlug: string, repoFullName: string): Promise<string[][]> {
  return (await activeDirections(orgSlug, repoFullName)).map((d) => d.fence);
}

export async function getLoopDirection(id: string): Promise<LoopDirectionRecord | null> {
  if (!isDbConfigured() || !id) return null;
  const row = await getPrisma().loopDirection.findUnique({ where: { id } });
  return row ? toDirectionRecord(row) : null;
}

/** The slug of the org that OWNS a direction — the resolve half of resolve-then-gate. */
export async function getLoopDirectionOrgSlug(id: string): Promise<string | null> {
  if (!isDbConfigured() || !id) return null;
  const row = await getPrisma().loopDirection.findUnique({ where: { id }, select: { org: { select: { slug: true } } } });
  return row?.org?.slug ?? null;
}

type Tx = Prisma.TransactionClient;

const RETURN_NOTE: Record<"exhausted" | "revoked" | "done", string> = {
  exhausted: "Returned for re-approval: its direction spent its budget before this plan ran.",
  revoked: "Returned for re-approval: its direction was revoked before this plan ran.",
  done: "Superseded: its direction was marked done before this plan ran.",
};

/** End a direction and settle its approved-but-unexecuted plans (see the header's lifecycle). */
export async function endDirectionIn(tx: Tx, id: string, status: "exhausted" | "revoked" | "done"): Promise<void> {
  await tx.loopDirection.update({ where: { id }, data: { status, endedAt: new Date() } });
  await tx.loopPlan.updateMany({
    where: { directionId: id, status: "approved" },
    data:
      status === "done"
        ? { status: "superseded", decisionNote: RETURN_NOTE.done }
        : { status: "pending", decidedBy: null, decidedAt: null, decisionNote: RETURN_NOTE[status] },
  });
}

/** Spend one cycle of a direction's budget; the cycle that reaches the budget exhausts it. */
export async function chargeDirectionCycleIn(tx: Tx, id: string): Promise<void> {
  const d = toDirectionRecord(await tx.loopDirection.update({ where: { id }, data: { usedCycles: { increment: 1 } } }));
  if (d.status === "active" && !directionHasBudget(d)) await endDirectionIn(tx, id, "exhausted");
}

/** A metered lane cost charged against the direction it ran under. Never throws. */
export async function chargeDirectionMicros(id: string, micros: number): Promise<void> {
  if (!isDbConfigured() || !id || !Number.isFinite(micros) || micros <= 0) return;
  await getPrisma()
    .$transaction(async (tx) => {
      const d = toDirectionRecord(await tx.loopDirection.update({ where: { id }, data: { usedMicros: { increment: BigInt(Math.round(micros)) } } }));
      if (d.status === "active" && !directionHasBudget(d)) await endDirectionIn(tx, id, "exhausted");
    })
    .catch(() => undefined);
}

/** Mark a spent direction exhausted outside any other write (the directed pick found it spent). */
export async function exhaustDirection(id: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().$transaction((tx) => endDirectionIn(tx, id, "exhausted"));
}

/**
 * The operator's `revoke` / `done`, only on a direction that has not already ended by the operator's
 * hand (an `exhausted` one may still be closed out). Null = not found or already ended.
 */
export async function settleDirection(id: string, action: "revoke" | "done"): Promise<LoopDirectionRecord | null> {
  if (!isDbConfigured()) return null;
  return getPrisma().$transaction(async (tx) => {
    const current = await tx.loopDirection.findUnique({ where: { id }, select: { status: true } });
    if (!current || (current.status !== "active" && current.status !== "exhausted")) return null;
    await endDirectionIn(tx, id, action === "revoke" ? "revoked" : "done");
    const row = await tx.loopDirection.findUnique({ where: { id } });
    return row ? toDirectionRecord(row) : null;
  });
}
