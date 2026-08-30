// PER-ITEM OUTCOMES — what happened to each row a lane was handed, and for how long a skip should
// stop the loop asking the same question again.
//
// THE PROBLEM THIS SOLVES. A lane dispatched five follow-ups and recorded one number: how many the
// rescan closed. An item the agent SKIPPED — because it needed a product decision, because the
// change was unsafe, because the repository had already solved it another way — was indistinguishable
// from one it simply failed at, so the next cycle picked it up again, spent another session on it,
// and skipped it again. The loop could not learn from a "no".
//
// A DEFERRAL IS NOT A DECISION ON THE ROW. `Recommendation.status` has four values
// (`open | in_progress | done | dismissed`) and none of them means "declined by an agent for now" —
// writing `dismissed` would be the loop closing a human's backlog item on an agent's say-so. So the
// deferral lives HERE, is advisory to `openBatch` alone, and every other surface still shows the item
// exactly as open as it is. The item's own timeline explains itself through a `RecommendationEvent`.
//
// THE RESCAN STILL WINS. `resolved` is written when the id is in the rescan's `closedIds`, whatever
// the agent claimed; the agent's verdict is only consulted for ids the rescan did not close.

import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import type { LaneReport, LaneVerdict } from "@/lib/local/lane-report";

/** How many cycles a skip holds before the loop is willing to try again. */
export const LANE_DEFER_CYCLES = 3;
/** Wall-clock ceiling on a deferral, so an item cannot be parked indefinitely by one bad session. */
export const LANE_DEFER_MAX_DAYS = 14;
/** Rough cycle length used to turn `LANE_DEFER_CYCLES` into a date. A cycle is a real working
 *  session; a day per cycle is the conservative reading and the cap bounds the error either way. */
const DEFER_DAYS_PER_CYCLE = 1;

/** The verdicts that park an item. An `attempted` or `absent` item is re-dispatchable immediately —
 *  nothing was learned that should stop the loop trying again. */
const DEFERRING: readonly LaneVerdict[] = ["skipped", "needs_human"];

/** One item's outcome, as a client reads it. Timestamps are STRINGS — see wire-safe.ts. */
export interface LaneOutcomeRow {
  id: string;
  runId: string;
  laneId: string;
  repoFullName: string;
  recommendationId: string;
  cycle: number;
  verdict: string;
  reason: string;
  files: string[];
  /** ISO string, or null when this outcome parks nothing. */
  deferUntil: string | null;
  createdAt: string;
}

type OutcomeRow = {
  id: string;
  runId: string;
  laneId: string;
  repoFullName: string;
  recommendationId: string;
  cycle: number;
  verdict: string;
  reason: string;
  filesJson: string;
  deferUntil: Date | null;
  createdAt: Date;
};

function toRow(row: OutcomeRow): LaneOutcomeRow {
  let files: string[] = [];
  try {
    const v: unknown = JSON.parse(row.filesJson || "[]");
    files = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    files = [];
  }
  return {
    id: row.id,
    runId: row.runId,
    laneId: row.laneId,
    repoFullName: row.repoFullName,
    recommendationId: row.recommendationId,
    cycle: row.cycle,
    verdict: row.verdict,
    reason: row.reason,
    files,
    deferUntil: row.deferUntil ? row.deferUntil.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The date a deferring verdict parks an item until, bounded. */
export function deferUntilFor(now: Date, cycles: number = LANE_DEFER_CYCLES): Date {
  const days = Math.min(LANE_DEFER_MAX_DAYS, Math.max(1, cycles * DEFER_DAYS_PER_CYCLE));
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export interface RecordOutcomesInput {
  orgSlug: string;
  runId: string;
  laneId: string;
  repoFullName: string;
  cycle: number;
  /** Every id the lane dispatched — the set the outcomes are written for, and nothing outside it. */
  batchIds: readonly string[];
  /** Ids the RESCAN closed. These are `resolved` whatever the agent said. */
  closedIds: readonly string[];
  /** The agent's own report, or null when it wrote none. */
  report: LaneReport | null;
  now?: Date;
}

/**
 * Write one outcome per dispatched id. Idempotent on `(laneId, recommendationId)`, so re-parsing a
 * report — a retry, a re-read after a crash — updates rather than duplicates.
 *
 * The precedence is deliberate and is the whole rule:
 *   1. the RESCAN closed it → `resolved`. The verifier outranks the claim, always.
 *   2. the AGENT said something about it → that verdict, with its own words as the reason.
 *   3. neither → `absent`. Nobody accounted for this id, which is a fact worth recording rather than
 *      a gap to fill with a guess.
 */
export async function recordLaneOutcomes(input: RecordOutcomesInput): Promise<LaneOutcomeRow[]> {
  if (!isDbConfigured()) return [];
  const org = await getOrgBySlug(input.orgSlug).catch(() => null);
  if (!org) return [];
  const prisma = getPrisma();
  const now = input.now ?? new Date();
  const closed = new Set(input.closedIds);
  const byId = new Map((input.report?.items ?? []).map((i) => [i.recommendationId, i]));
  const written: LaneOutcomeRow[] = [];

  for (const id of new Set(input.batchIds)) {
    const claim = byId.get(id);
    const verdict: LaneVerdict = closed.has(id) ? "resolved" : (claim?.verdict ?? "absent");
    // A resolved item is never deferred: it is done, and the next cycle will not see it anyway.
    const deferUntil = DEFERRING.includes(verdict) ? deferUntilFor(now) : null;
    const data = {
      orgId: org.id,
      runId: input.runId,
      laneId: input.laneId,
      repoFullName: input.repoFullName,
      recommendationId: id,
      cycle: input.cycle,
      verdict,
      // The agent's OWN words, or "" — never a sentence written on its behalf.
      reason: claim?.reason ?? "",
      filesJson: JSON.stringify(claim?.files ?? []),
      deferUntil,
    };
    const row = await prisma.laneItemOutcome
      .upsert({
        where: { laneId_recommendationId: { laneId: input.laneId, recommendationId: id } },
        create: data,
        update: { verdict, reason: data.reason, filesJson: data.filesJson, deferUntil },
      })
      .catch(() => null);
    if (row) written.push(toRow(row as OutcomeRow));
    // The item's own timeline explains itself: without this a reader of the backlog row sees it go
    // in_progress and come back open with no account of why.
    await prisma.recommendationEvent
      .create({
        data: {
          recommendationId: id,
          actor: "autopilot",
          kind: "lane_verdict",
          toValue: verdict,
          note: claim?.reason ? claim.reason.slice(0, 500) : `Loop cycle ${input.cycle}: ${verdict}`,
        },
      })
      .catch(() => null);
  }
  return written;
}

/**
 * Recommendation ids this repo should NOT be re-offered yet, because a lane parked them.
 *
 * Org- AND repo-scoped: a deferral is a fact about one repository's item, and a cross-tenant read
 * here would let one org's skip suppress another's backlog. One indexed read
 * (`@@index([orgId, recommendationId])`), on the path `openBatch` already awaits.
 */
export async function getActiveDeferrals(orgSlug: string, repoFullName: string, now: Date = new Date()): Promise<Set<string>> {
  if (!isDbConfigured()) return new Set();
  return dbReadSafe<Set<string>>(async () => {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return new Set();
    const rows = await getPrisma().laneItemOutcome.findMany({
      where: { orgId: org.id, repoFullName, deferUntil: { gt: now } },
      select: { recommendationId: true },
    });
    return new Set(rows.map((r) => r.recommendationId));
  }, new Set());
}

/** Every outcome of one run, newest lane first — the per-item ledger the cockpit renders. */
export async function listRunOutcomes(runId: string): Promise<LaneOutcomeRow[]> {
  if (!isDbConfigured()) return [];
  return dbReadSafe<LaneOutcomeRow[]>(async () => {
    const rows = await getPrisma().laneItemOutcome.findMany({
      where: { runId },
      orderBy: [{ createdAt: "desc" }, { recommendationId: "asc" }],
    });
    return (rows as OutcomeRow[]).map(toRow);
  }, []);
}
