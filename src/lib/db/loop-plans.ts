// LOOP PLANS — every plan-mode lane's plan, and the approval inbox's population
// (spark theater-upgrade, 2026-09-18; WP3 implements the reads and writes).
//
// A plan's items are keyed on their DURABLE identity (`recommendationDecisionKey(repo, dimId, title)`),
// because Recommendation rows are recreated on every scan: a decision keyed on a row id dies at the
// next rescan (`audit-logging/decision-records`). `recIdsJson` and `itemTitlesJson` are kept ALIGNED
// with `itemKeysJson` (same index = same item): the key is a hash and the row id dies at the next
// rescan, so the title AS IT READ when the plan was written is what lets the inbox name the item.
//
// Tenancy: every org-scoped read resolves `orgId` from the slug server-side and ANDs it into the
// query. `getLoopPlan(id)` is the one id-only read, and it exists for RESOLVE-THEN-GATE: the route
// derives the owning org from the row (`getLoopPlanOrgSlug`) and gates THAT org before disclosing it.
//
// Writes live in loop-plans-write.ts (which imports the mapper from here; never the other way round,
// so the two modules cannot form an import cycle).

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { parseStringArray } from "@/lib/db/json-columns";
import { orgIdForSlug } from "@/lib/db/loop-tenancy";
import { validatePlan } from "@/lib/local/lane-plan-parse";
import {
  PLAN_HOLDS_ITEMS,
  type LoopPlanRecord,
  type ModulePartition,
  type PlanClass,
  type PlanClassReason,
  type PlanStatus,
} from "@/lib/local/runner-types";

const PLAN_STATUSES: readonly PlanStatus[] = ["executing", "landed", "held", "pending", "approved", "revise", "rejected", "superseded", "failed"];
export const isPlanStatus = (v: unknown): v is PlanStatus => typeof v === "string" && (PLAN_STATUSES as readonly string[]).includes(v);

const CLASSES: readonly PlanClass[] = ["minor", "major", "minor-under-direction"];
const REASONS: readonly PlanClassReason[] = ["no-moves", "declared-moves", "unreadable", "undeclared-moves-in-diff", "inside-direction-fence"];

/** The row as Prisma returns it. */
export interface LoopPlanRow {
  id: string;
  orgId: string;
  repo: string;
  runId: string | null;
  laneId: string | null;
  directionId: string | null;
  itemKeysJson: string;
  recIdsJson: string;
  itemTitlesJson: string;
  planJson: string;
  planText: string;
  partitionJson: string | null;
  cls: string;
  clsReason: string | null;
  status: string;
  sessionId: string | null;
  heldBranch: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function parsePartition(raw: string | null): ModulePartition | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<ModulePartition>;
    if ((p.source === "context-map" || p.source === "workspace" || p.source === "directory") && Array.isArray(p.modules)) {
      return { source: p.source, modules: p.modules.filter((m): m is string => typeof m === "string") };
    }
  } catch {
    /* unreadable partition → null */
  }
  return null;
}

function parseStoredPlan(raw: string): LoopPlanRecord["plan"] {
  try {
    return validatePlan(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Row → wire record. Timestamps become ISO strings; JSON columns are re-validated, never trusted. */
export function toPlanRecord(row: LoopPlanRow): LoopPlanRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    repo: row.repo,
    runId: row.runId,
    laneId: row.laneId,
    directionId: row.directionId,
    itemKeys: parseStringArray(row.itemKeysJson) ?? [],
    recIds: parseStringArray(row.recIdsJson) ?? [],
    itemTitles: parseStringArray(row.itemTitlesJson) ?? [],
    plan: parseStoredPlan(row.planJson),
    planText: row.planText,
    partition: parsePartition(row.partitionJson),
    cls: (CLASSES as readonly string[]).includes(row.cls) ? (row.cls as PlanClass) : "major",
    clsReason: (REASONS as readonly string[]).includes(row.clsReason ?? "") ? (row.clsReason as PlanClassReason) : null,
    status: isPlanStatus(row.status) ? row.status : "failed",
    sessionId: row.sessionId,
    heldBranch: row.heldBranch,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The durable keys of this repo's items a plan currently HOLDS (pending | approved), so `openBatch`
 *  does not re-dispatch work that is waiting on, or promised to, a decision. A `revise` plan holds
 *  nothing: its items return to the backlog and are re-planned with the operator's note. */
export async function heldPlanKeys(orgSlug: string, repoFullName: string): Promise<Set<string>> {
  const out = new Set<string>();
  if (!isDbConfigured()) return out;
  const orgId = await orgIdForSlug(orgSlug);
  if (!orgId) return out;
  const rows = await getPrisma().loopPlan.findMany({
    where: { orgId, repo: repoFullName, status: { in: [...PLAN_HOLDS_ITEMS] } },
    select: { itemKeysJson: true },
  });
  for (const r of rows) for (const k of parseStringArray(r.itemKeysJson) ?? []) out.add(k);
  return out;
}

const LIST_DEFAULT = 50;
const LIST_CAP = 200;

/** An org's plans, newest first, optionally by status and repo. */
export async function listLoopPlans(
  orgSlug: string,
  opts: { status?: PlanStatus[]; repo?: string; limit?: number } = {},
): Promise<LoopPlanRecord[]> {
  if (!isDbConfigured()) return [];
  const orgId = await orgIdForSlug(orgSlug);
  if (!orgId) return [];
  const take = Math.min(LIST_CAP, Math.max(1, Math.floor(opts.limit ?? LIST_DEFAULT)));
  const rows = await getPrisma().loopPlan.findMany({
    where: {
      orgId,
      ...(opts.repo ? { repo: opts.repo } : {}),
      ...(opts.status?.length ? { status: { in: opts.status } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map(toPlanRecord);
}

/** This repo's APPROVED plans, OLDEST first — the directed queue `nextDirectedBatch` walks. */
export async function listApprovedPlans(orgSlug: string, repoFullName: string): Promise<LoopPlanRecord[]> {
  if (!isDbConfigured()) return [];
  const orgId = await orgIdForSlug(orgSlug);
  if (!orgId) return [];
  const rows = await getPrisma().loopPlan.findMany({
    where: { orgId, repo: repoFullName, status: "approved" },
    orderBy: { createdAt: "asc" },
    take: LIST_CAP,
  });
  return rows.map(toPlanRecord);
}

/** One plan by id, or null. The caller resolves the OWNING org from the row (resolve-then-gate). */
export async function getLoopPlan(id: string): Promise<LoopPlanRecord | null> {
  if (!isDbConfigured() || !id) return null;
  const row = await getPrisma().loopPlan.findUnique({ where: { id } });
  return row ? toPlanRecord(row) : null;
}

/** The slug of the org that OWNS a plan — the resolve half of resolve-then-gate. */
export async function getLoopPlanOrgSlug(id: string): Promise<string | null> {
  if (!isDbConfigured() || !id) return null;
  const row = await getPrisma().loopPlan.findUnique({ where: { id }, select: { org: { select: { slug: true } } } });
  return row?.org?.slug ?? null;
}
