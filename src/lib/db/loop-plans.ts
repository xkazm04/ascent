// LOOP PLANS — every plan-mode lane's plan, and the approval inbox's population
// (spark theater-upgrade, 2026-09-18; WP3 implements the reads and writes).
//
// A plan's items are keyed on their DURABLE identity (`recommendationDecisionKey(repo, dimId, title)`),
// because Recommendation rows are recreated on every scan: a decision keyed on a row id dies at the
// next rescan (`audit-logging/decision-records`).

import type { LoopPlanRecord, PlanStatus } from "@/lib/local/runner-types";

/** The durable keys of this repo's items a plan currently HOLDS (pending | revise | approved), so
 *  `openBatch` does not re-dispatch work that is waiting on, or promised to, a decision. STUB: none. */
export async function heldPlanKeys(_orgSlug: string, _repoFullName: string): Promise<Set<string>> {
  return new Set<string>();
}

/** An org's plans, newest first, optionally by status. STUB (WP0): none. */
export async function listLoopPlans(
  _orgSlug: string,
  _opts: { status?: PlanStatus[]; repo?: string; limit?: number } = {},
): Promise<LoopPlanRecord[]> {
  return [];
}

/** One plan by id, or null. The caller resolves the OWNING org from the row (resolve-then-gate). STUB. */
export async function getLoopPlan(_id: string): Promise<LoopPlanRecord | null> {
  return null;
}
