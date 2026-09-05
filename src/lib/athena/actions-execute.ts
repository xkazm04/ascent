// THE EXECUTOR BINDING — the impure half of the catalog.
//
// `ATHENA_ACTION_EXECUTORS` is typed `Record<AthenaActionId, …>`, and that is the derivation: adding an
// action to `ATHENA_ACTIONS` without adding its executor here does not compile, and an executor for an
// id the catalog no longer carries does not compile either. `actions.test.ts` asserts the same set
// equality at runtime, so the pair cannot drift even through an `any`.
//
// EVERY EXECUTOR DISPATCHES MACHINERY THAT ALREADY EXISTS, and neither of them reaches outside Ascent
// or spends money. That is not a coincidence — it is the bar for an action being in the catalog at all.
//
//   handoff_followups → the semantics of POST /api/org/followups/handoff, whole-request refusal on a
//                       foreign id included, so ids cannot be enumerated through this door either.
//   rule_on_finding   → `decide()` (org-decisions.ts), which upserts sparsely, writes through to
//                       OrgMemory and audits itself. There is no second decision store.
//
// AN EXECUTOR NEVER THROWS FOR A REFUSAL. "These items are already done", "that finding is not in this
// tenant", "a snooze needs a future date" are all ANSWERS — they come back as an outcome with
// `ok: false`, are stamped onto the proposal, and the operator reads what happened. A throw here means
// something genuinely broke, and the resolve route treats it as one: the claim is released and the
// proposal goes back to open so the click can be retried.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getRecommendationOrgSlug, updateRecommendation } from "@/lib/db/scans-recommendations";
import { decide, isDecisionModule, type DecisionModule, type DecisionStatus } from "@/lib/db/org-decisions";
import {
  ATHENA_ACTION_MAX_IDS,
  type AthenaAction,
  type AthenaActionId,
  type AthenaActionOutcome,
  type AthenaActionParamValues,
} from "@/lib/athena/actions";

/** What an executor is handed besides its parameters. Resolved by the resolve route, never guessed. */
export interface AthenaActionContext {
  /** The org slug, already authorized. */
  org: string;
  /** The org's id, resolved server-side. The tenant boundary, ANDed into every read below. */
  orgId: string;
  /** The human who clicked Accept. Null on an auth-off deployment. */
  actor: string | null;
}

export type AthenaActionExecutor = (
  params: AthenaActionParamValues,
  ctx: AthenaActionContext,
) => Promise<AthenaActionOutcome>;

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
const many = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);

const refuse = (detail: string, data?: Record<string, unknown>): AthenaActionOutcome => ({
  ok: false,
  kind: "refused",
  detail,
  ...(data ? { data } : {}),
});

// ── handoff_followups ───────────────────────────────────────────────────────────────────────────

/**
 * Claim follow-up items: `open → in_progress`, with a timeline note saying how.
 *
 * THE TENANCY RE-CHECK IS PER-ID AND ITS REFUSAL IS WHOLE-ACTION. A foreign id is not skipped and
 * reported alongside the ones that worked — that response would be an oracle: a caller could feed a
 * guessed id and learn from the shape of the answer whether it exists somewhere. One foreign id
 * refuses the entire action, exactly as the route returns a whole-request 403.
 *
 * IDEMPOTENT, and `done` / `dismissed` are NEVER reopened. A second Accept on the same proposal cannot
 * happen (the claim is compare-and-set), but a batch that includes an item someone has since closed is
 * a stale selection, not an instruction to reopen it — those ids come back in `skipped`.
 *
 * HUMAN-IN-THE-LOOP BY CONSTRUCTION. This records the claim and nothing else. The fix is a prompt a
 * person runs somewhere else; the product cannot execute it, and the boundary ends at a string.
 */
const handoffFollowups: AthenaActionExecutor = async (params, ctx) => {
  if (!isDbConfigured()) return refuse("Follow-up tracking requires a database.");
  const ids = many(params.ids);
  if (ids.length === 0) return refuse("No follow-up items were named.");
  if (ids.length > ATHENA_ACTION_MAX_IDS) {
    return refuse(`At most ${ATHENA_ACTION_MAX_IDS} items per hand-off.`);
  }

  for (const id of ids) {
    const owner = await getRecommendationOrgSlug(id);
    if (!owner || owner.trim().toLowerCase() !== ctx.org) {
      return refuse("One or more of those items do not belong to this organization.");
    }
  }

  const note = one(params.note) || "Handed off: claimed from a conversation with Athena";
  const rows = await getPrisma().recommendation.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true },
  });
  const statusOf = new Map(rows.map((r) => [r.id, r.status]));

  const marked: string[] = [];
  const skipped: { id: string; status: string }[] = [];
  for (const id of ids) {
    const status = statusOf.get(id);
    if (status === "open") {
      await updateRecommendation(id, { status: "in_progress" }, { actor: ctx.actor, note });
      marked.push(id);
    } else if (status) {
      skipped.push({ id, status });
    }
  }

  if (marked.length === 0) {
    return refuse(
      skipped.length > 0
        ? "Every one of those items had already moved on — nothing was changed."
        : "None of those items are still on the ledger.",
      { marked, skipped },
    );
  }
  const tail = skipped.length > 0 ? `; ${skipped.length} had already moved on` : "";
  return {
    ok: true,
    kind: "handed_off",
    detail: `Claimed ${marked.length} follow-up item${marked.length === 1 ? "" : "s"} as in progress${tail}.`,
    data: { marked, skipped },
  };
};

// ── rule_on_finding ─────────────────────────────────────────────────────────────────────────────

/**
 * Record the team's ruling on one finding, carrying the reasoning into the org's memory and the next
 * scan's prompt — `decide()` does all of that, and it audits itself, so this executor is an adapter.
 *
 * The snooze date is checked HERE rather than in the validator on purpose: `snoozedUntil` being in the
 * future is a fact about the clock at CLICK time, and a proposal raised on Monday for a Tuesday snooze
 * is legitimately dead by Wednesday. Refusing it here says so; refusing it at proposal time would have
 * been a guess that aged badly.
 */
const ruleOnFinding: AthenaActionExecutor = async (params, ctx) => {
  if (!isDbConfigured()) return refuse("Decisions require a database.");
  const moduleId = one(params.module);
  const itemKey = one(params.itemKey);
  const ruling = one(params.ruling);
  const rationale = one(params.rationale);

  // The store is the authority on what a module is, not the catalog's declared value set. The two are
  // pinned together by a test; this is the check that holds if one of them is ever edited alone.
  if (!isDecisionModule(moduleId)) return refuse(`"${moduleId}" is not a decision surface in this build.`);
  if (!itemKey) return refuse("The finding was not named.");
  if (!rationale) return refuse("A ruling with no reason is a silent suppression; nothing was recorded.");

  let snoozedUntil: Date | null = null;
  if (ruling === "snoozed") {
    const raw = one(params.snoozedUntil);
    const parsed = raw ? new Date(raw) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed <= new Date()) {
      return refuse("A snooze needs a date in the future; nothing was recorded.");
    }
    snoozedUntil = parsed;
  }

  const result = await decide(
    ctx.org,
    {
      module: moduleId as DecisionModule,
      itemKey,
      status: ruling as DecisionStatus,
      rationale,
      title: one(params.title),
      snoozedUntil,
    },
    ctx.actor,
  );
  if (!result) return refuse("The ruling could not be recorded for this organization.");

  const verb = ruling === "accepted" ? "Accepted" : ruling === "snoozed" ? "Snoozed" : "Dismissed";
  return {
    ok: true,
    kind: "ruled",
    detail: `${verb} ${one(params.title) || itemKey}. ${result.memoryId ? "Published to the organization's memory." : "Recorded; memory is not available on this plan."}`,
    data: { decisionId: result.id, memoryId: result.memoryId, module: moduleId, itemKey, ruling },
  };
};

// ── the binding ─────────────────────────────────────────────────────────────────────────────────

/**
 * One executor per catalog id. `Record<AthenaActionId, …>` is what makes this a DERIVATION rather than
 * a second list: TypeScript refuses a missing key and refuses an extra one.
 */
export const ATHENA_ACTION_EXECUTORS: Record<AthenaActionId, AthenaActionExecutor> = {
  handoff_followups: handoffFollowups,
  rule_on_finding: ruleOnFinding,
};

/**
 * Run one validated action. The catalog is consulted ONE more time here — an id with no executor comes
 * back as a retired outcome rather than a thrown `undefined is not a function`, which matters because
 * a proposal outlives the build that raised it.
 */
export async function executeAthenaAction(
  action: AthenaAction,
  ctx: AthenaActionContext,
): Promise<AthenaActionOutcome> {
  const executor = ATHENA_ACTION_EXECUTORS[action.id];
  if (!executor) {
    return { ok: false, kind: "retired", detail: "This build no longer carries that action." };
  }
  return executor(action.params, ctx);
}
