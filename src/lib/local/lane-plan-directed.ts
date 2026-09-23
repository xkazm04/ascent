// THE DIRECTED QUEUE — an approved major plan, due to execute on this repo
// (spark theater-upgrade, 2026-09-18; WP3).
//
// `nextDirectedBatch` walks the repo's `approved` plans OLDEST first and returns the first one that
// can still run, re-resolved to TODAY's open rows by durable key (Recommendation ids are recreated on
// every scan; the plan was approved about the gap, not the row). On the way it settles what it meets:
//   • a plan whose direction is gone or ended (revoked / done / exhausted) → back to `pending` — an
//     ended grant never executes anything (normally the lifecycle already did this; this heals races);
//   • a plan whose direction has no budget left → the direction is `exhausted`, which returns ALL its
//     approved plans to `pending`: they wait for re-approval, they are never run on a spent grant;
//   • a plan none of whose items is open any more → `superseded`.
// The chosen plan moves `approved → executing` conditionally (two lanes cannot both take it) and its
// direction is charged one cycle. It executes in a FRESH session — the planning session that wrote it
// is days old — with the approved plan as its fixed tier. UNLESS the plan carries a held branch: then
// the fence already parked the finished commits the operator reviewed, and the lane ADOPTS them
// (`adoptBranch`, lane-adopt.ts) instead of paying a second session to re-derive something nobody was
// shown — the fresh session stays as the fallback when they no longer apply. Every db access is a LAZY
// import.

import type { FollowUpItem } from "@/lib/org/followups";
import { effectiveMoves } from "@/lib/local/lane-plan-classify";
import { buildPlanBlock, type PlannedItem } from "@/lib/local/lane-plan-prompt";
import type { ArchitectureMove, LoopPlanRecord } from "@/lib/local/runner-types";

/** An APPROVED major plan whose items are due to execute, re-resolved to today's recommendation ids. */
export interface DirectedBatch {
  planId: string;
  directionId: string;
  items: FollowUpItem[];
  /** The approved plan, as the execution session's fixed tier. Executed in a FRESH session. */
  planBlock: string;
  directionFence: string[];
  declaredMoves: ArchitectureMove[];
  /** The approved plan's held branch — the commits the fence parked and the operator reviewed. When
   *  set, the lane adopts them instead of dispatching a session; null executes the plan fresh. */
  adoptBranch: string | null;
}

/** Today's rows for a plan's keys, each paired with the plan's entry for it (via the aligned rec id). */
function resolvePlanItems(plan: LoopPlanRecord, today: ReadonlyMap<string, FollowUpItem>): PlannedItem[] {
  const out: PlannedItem[] = [];
  plan.itemKeys.forEach((key, i) => {
    const item = today.get(key);
    if (!item) return;
    const entry = plan.plan?.items.find((e) => e.recommendationId === plan.recIds[i]) ?? null;
    out.push({ item, entry, moves: entry ? effectiveMoves(entry.moves, plan.partition) : [] });
  });
  return out;
}

/** The next approved plan to execute on this repo, or null. Never throws — no plan is "no plan". */
export async function nextDirectedBatch(org: string, repo: string): Promise<DirectedBatch | null> {
  try {
    const { listApprovedPlans } = await import("@/lib/db/loop-plans");
    const plans = await listApprovedPlans(org, repo);
    if (plans.length === 0) return null;
    const writes = await import("@/lib/db/loop-plans-write");
    const directions = await import("@/lib/db/loop-directions");
    let today: Map<string, FollowUpItem> | null = null;
    for (const plan of plans) {
      const direction = plan.directionId ? await directions.getLoopDirection(plan.directionId) : null;
      if (!direction || direction.status !== "active") {
        await writes.returnApprovedPlan(plan.id, "Returned for re-approval: its direction is no longer active.");
        continue;
      }
      if (!directions.directionHasBudget(direction)) {
        await directions.exhaustDirection(direction.id);
        continue;
      }
      today ??= await (await import("@/lib/db/loop-plan-items")).openItemsByKey(org, repo);
      const planned = resolvePlanItems(plan, today);
      if (planned.length === 0) {
        await writes.supersedeApprovedPlan(plan.id, "Superseded: none of its items is open any more.");
        continue;
      }
      // Keys, today's ids and the titles AS APPROVED stay index-aligned on the executing row.
      const kept = plan.itemKeys.map((k, i) => ({ k, title: plan.itemTitles[i] ?? "" })).filter((x) => today!.has(x.k));
      const started = await writes.startDirectedPlan(
        plan.id,
        direction.id,
        planned.map((p) => p.item.id),
        kept.map((x) => x.k),
        kept.map((x, i) => x.title || planned[i]!.item.title),
      );
      if (!started) continue;
      return {
        planId: plan.id,
        directionId: direction.id,
        items: planned.map((p) => p.item),
        planBlock: buildPlanBlock({ plan: plan.plan, items: planned, directionFence: direction.fence, directed: true }),
        directionFence: direction.fence,
        declaredMoves: planned.flatMap((p) => p.moves),
        adoptBranch: plan.heldBranch ?? null,
      };
    }
    return null;
  } catch {
    return null;
  }
}
