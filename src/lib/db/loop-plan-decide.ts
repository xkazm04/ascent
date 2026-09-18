// THE OPERATOR'S VERDICT ON A PENDING PLAN (spark theater-upgrade, 2026-09-18; WP3).
//
//   approve → a LoopDirection is created (title = the plan's intent, fence = the edited fence or the
//             plan's own modules, check = the plan's check, a cycle budget and an optional cost
//             budget) and the plan becomes `approved` under it. ONE transaction: a direction without
//             its approved plan, or an approved plan without its direction, cannot exist.
//   reject  → every item gets a STANDING DISMISSAL through the existing roadmap-dismissal path: an
//             OrgDecision (`roadmap`, `dismissed`, the operator's note as the rationale) keyed on the
//             item's durable key — which the next scan's prompt reads, so the gap stops being
//             re-raised — and today's open row, when there is one, is dismissed the way the
//             recommendations PATCH dismisses it (status carries forward across rescans). Then the
//             plan becomes `rejected`.
//   revise  → the plan becomes `revise`; the note is what the next planning session is shown.
// Every verdict stamps decidedBy / decidedAt / decisionNote and writes an audit row. `note` is
// mandatory on reject and revise (`plan-review`: a disposition without a rationale is a keypress).
//
// NEVER A PHANTOM DECISION. The plan's status moves LAST and conditionally (`pending → …`): a write that
// fails before it returns 500 and leaves the plan `pending`; a plan someone else decided meanwhile
// returns 409. A rejection that fails half-way may have written some items' dismissals — each is an
// idempotent upsert, so re-sending the rejection completes it rather than duplicating it.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { ROADMAP_DECISION_MODULE, decide } from "@/lib/db/org-decisions";
import { recordAudit } from "@/lib/db/scans-audit";
import { updateRecommendation } from "@/lib/db/scans-recommendations";
import { getLoopPlan } from "@/lib/db/loop-plans";
import { toDirectionRecord } from "@/lib/db/loop-directions";
import { openItemsByKey } from "@/lib/db/loop-plan-items";
import { normalizeFence } from "@/lib/local/lane-plan-classify";
import { REC_NOTE_MAX_LENGTH } from "@/lib/types";
import type { LoopDirectionRecord, LoopPlanRecord, PlanDecisionBody } from "@/lib/local/runner-types";

export const DECISION_NOTE_MAX = 1_000;
export const DEFAULT_BUDGET_CYCLES = 3;
export const BUDGET_CYCLES_MAX = 50;
/** Micro-cents per USD — the unit `agent-envelope.ts` meters in (the column is a BigInt for it). */
const MICROS_PER_USD = 100 * 1_000_000;
/** A sanity ceiling on one direction's cost budget — a typo guard, not a column limit. */
export const BUDGET_USD_MAX = 10_000;

/** Validate `POST /api/org/loop/plans/[id]`'s body. */
export function parseDecisionBody(raw: unknown): { ok: true; body: PlanDecisionBody } | { ok: false; error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const decision = b.decision;
  if (decision !== "approve" && decision !== "revise" && decision !== "reject") {
    return { ok: false, error: "'decision' must be approve, revise or reject." };
  }
  if (b.note !== undefined && typeof b.note !== "string") return { ok: false, error: "'note' must be a string." };
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (note.length > DECISION_NOTE_MAX) return { ok: false, error: `'note' must be at most ${DECISION_NOTE_MAX} characters.` };
  if (decision !== "approve" && !note) return { ok: false, error: `A ${decision} needs a note — it is what the next plan, or the next scan, learns from.` };
  const body: PlanDecisionBody = { decision, note };
  if (decision === "approve") {
    if (b.fence !== undefined) {
      if (!Array.isArray(b.fence) || b.fence.length > 40 || !b.fence.every((f) => typeof f === "string")) {
        return { ok: false, error: "'fence' must be a list of at most 40 module prefixes." };
      }
      body.fence = normalizeFence(b.fence as string[]);
    }
    if (b.budgetCycles !== undefined) {
      if (typeof b.budgetCycles !== "number" || !Number.isInteger(b.budgetCycles) || b.budgetCycles < 1 || b.budgetCycles > BUDGET_CYCLES_MAX) {
        return { ok: false, error: `'budgetCycles' must be a whole number from 1 to ${BUDGET_CYCLES_MAX}.` };
      }
      body.budgetCycles = b.budgetCycles;
    }
    if (b.budgetUsd !== undefined && b.budgetUsd !== null) {
      if (typeof b.budgetUsd !== "number" || !Number.isFinite(b.budgetUsd) || b.budgetUsd <= 0 || b.budgetUsd > BUDGET_USD_MAX) {
        return { ok: false, error: `'budgetUsd' must be a positive amount of at most $${BUDGET_USD_MAX}.` };
      }
      body.budgetUsd = b.budgetUsd;
    }
  }
  return { ok: true, body };
}

export type PlanDecisionOutcome =
  | { ok: true; plan: LoopPlanRecord; direction: LoopDirectionRecord | null }
  | { ok: false; status: 404 | 409 | 500 | 503; error: string };

class DecisionConflict extends Error {}

const now = () => new Date();
const firstLine = (s: string) => (s.split("\n").find((l) => l.trim()) ?? "").trim();

/** The dimension a durable key carries (`<repo>::rec:<dim>:<hash>`, rec-identity.ts), or null. */
const dimOfKey = (key: string): string | null => /::rec:([^:]+):[^:]+$/.exec(key)?.[1] ?? null;

/** Standing dismissals for every item of a rejected plan (see the header). Throws on any failure.
 *  The decision is titled with the item's name AS IT READ when the plan was written (the operator
 *  decided about that wording), falling back to today's row, the plan's original row, then the key. */
async function dismissItems(plan: LoopPlanRecord, orgSlug: string, note: string, decidedBy: string | null): Promise<void> {
  const today = await openItemsByKey(orgSlug, plan.repo);
  const recs = plan.recIds.length
    ? await getPrisma().recommendation.findMany({ where: { id: { in: plan.recIds } }, select: { id: true, title: true, dimId: true } })
    : [];
  const recById = new Map(recs.map((r) => [r.id, r]));
  for (let i = 0; i < plan.itemKeys.length; i++) {
    const key = plan.itemKeys[i]!;
    const row = today.get(key);
    const known = row ?? recById.get(plan.recIds[i] ?? "");
    const name = plan.itemTitles[i]?.trim() || known?.title.trim() || "";
    const dim = known?.dimId ?? dimOfKey(key);
    const title = name ? (dim ? `${name} (${dim})` : name) : key;
    const written = await decide(orgSlug, { module: ROADMAP_DECISION_MODULE, itemKey: key, status: "dismissed", rationale: note, title }, decidedBy);
    if (!written) throw new Error(`the standing decision for ${key} was not recorded`);
    if (row) await updateRecommendation(row.id, { status: "dismissed" }, { actor: decidedBy, note: note.slice(0, REC_NOTE_MAX_LENGTH) });
  }
}

async function audit(plan: LoopPlanRecord, body: PlanDecisionBody, decidedBy: string | null, direction: LoopDirectionRecord | null): Promise<void> {
  const meta = {
    planId: plan.id,
    repo: plan.repo,
    items: plan.itemKeys.length,
    clsReason: plan.clsReason,
    note: body.note || null,
    ...(direction ? { directionId: direction.id, fence: direction.fence, budgetCycles: direction.budgetCycles, budgetMicros: direction.budgetMicros } : {}),
  };
  const opts = { orgId: plan.orgId, ...(decidedBy ? { actorId: decidedBy } : {}) };
  if (body.decision === "approve") await recordAudit("loop.plan_approved", meta, opts);
  else if (body.decision === "reject") await recordAudit("loop.plan_rejected", meta, opts);
  else await recordAudit("loop.plan_revised", meta, opts);
}

/** Apply a verdict to a plan the caller has already gated (resolve-then-gate, owner). */
export async function decideLoopPlan(input: {
  plan: LoopPlanRecord;
  orgSlug: string;
  body: PlanDecisionBody;
  decidedBy: string | null;
}): Promise<PlanDecisionOutcome> {
  const { plan, body, decidedBy } = input;
  if (!isDbConfigured()) return { ok: false, status: 503, error: "Plan decisions require a database." };
  if (plan.status !== "pending") return { ok: false, status: 409, error: `This plan is already ${plan.status}.` };
  const stamp = { decidedBy, decidedAt: now(), decisionNote: body.note || null };
  let direction: LoopDirectionRecord | null = null;
  try {
    if (body.decision === "approve") {
      const fence = body.fence ?? normalizeFence(plan.plan?.modules ?? []);
      const title = (plan.plan?.intent || firstLine(plan.planText) || `Approved plan for ${plan.repo}`).slice(0, 300);
      const created = await getPrisma().$transaction(async (tx) => {
        const row = await tx.loopDirection.create({
          data: {
            orgId: plan.orgId,
            repo: plan.repo,
            title,
            fenceJson: JSON.stringify(fence),
            checkText: plan.plan?.check ?? "",
            budgetCycles: body.budgetCycles ?? DEFAULT_BUDGET_CYCLES,
            budgetMicros: body.budgetUsd != null ? BigInt(Math.round(body.budgetUsd * MICROS_PER_USD)) : null,
            originPlanId: plan.id,
            approvedBy: decidedBy,
            approvedAt: stamp.decidedAt,
          },
        });
        const moved = await tx.loopPlan.updateMany({ where: { id: plan.id, status: "pending" }, data: { status: "approved", directionId: row.id, ...stamp } });
        if (moved.count !== 1) throw new DecisionConflict();
        return row;
      });
      direction = toDirectionRecord(created);
    } else {
      if (body.decision === "reject") await dismissItems(plan, input.orgSlug, body.note, decidedBy);
      const moved = await getPrisma().loopPlan.updateMany({
        where: { id: plan.id, status: "pending" },
        data: { status: body.decision === "reject" ? "rejected" : "revise", ...stamp },
      });
      if (moved.count !== 1) throw new DecisionConflict();
    }
  } catch (err) {
    if (err instanceof DecisionConflict) return { ok: false, status: 409, error: "This plan was decided by someone else meanwhile." };
    console.error("[loop-plans] decision failed; the plan stays pending", err instanceof Error ? err.message : err);
    return { ok: false, status: 500, error: "The decision could not be recorded; the plan is still pending." };
  }
  await audit(plan, body, decidedBy, direction);
  const updated = await getLoopPlan(plan.id).catch(() => null);
  return { ok: true, plan: updated ?? { ...plan, status: body.decision === "approve" ? "approved" : body.decision === "reject" ? "rejected" : "revise" }, direction };
}
