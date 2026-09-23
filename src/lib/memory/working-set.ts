// WHICH ROWS EACH LIFECYCLE PASS REASONS OVER: the pure half. Recall, forget and the MCP door used to
// share one loader that asked for the 400 most recently edited rows and only then applied the value
// model, the forget conjunction or the query filter. Recency picked the population and each policy saw
// only what recency let through: a 120-day-old runbook lost to 400 fresh scan episodes before it was
// scored, and the forget pass (which may only archive rows older than 60 days) was shown the 400
// newest, so on a busy store it evaluated nothing it could ever retire.
//
// The rule here is that each pass's population is chosen by that pass's OWN rule:
//   - recall: the cap is split into per-kind LANES (`planRecallLanes`), so one noisy kind cannot
//     starve the others, and the part of the store the cap leaves out is COUNTED (`notConsidered`) so
//     the answer can say in-band how much it never looked at;
//   - forget: the predicate is DERIVED from decay.ts's own row-level constants
//     (`decayPopulationWhere`), so the rows loaded are exactly the ones the conjunction could act on.
//     A limit restated here would drift from the policy the first time someone tunes it.
//
// Pure: no Prisma client, no clock. The db loaders in src/lib/db/org-memory-population.ts run it.

import type { Prisma } from "@prisma/client";
import { DECAY_EXEMPT_KINDS, DECAY_MAX_CONFIDENCE, DECAY_MIN_AGE_DAYS } from "@/lib/memory/decay";

/** Hard cap on how many rows one lifecycle pass loads. Recall scores the population in memory and
 *  reflection is O(n²) pairwise, so this bounds both the CPU and (via the cores' own caps) the prompt. */
export const RECALL_POPULATION_MAX = 400;

/** How many forget-eligible rows one pass loads, oldest first. The pass archives at most
 *  DECAY_MAX_PER_PASS of them; the rest wait for the next pass. */
export const DECAY_POPULATION_MAX = 400;

const MS_PER_DAY = 86_400_000;

export interface RecallLanePlan {
  /** Rows to load per kind. Every kind in the input appears, 0 when it gets none. */
  quotas: Record<string, number>;
  /** Eligible rows the cap leaves out: total - sum(quotas). Never scored, so never ranked. */
  notConsidered: number;
}

const wholeCount = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/**
 * Split `limit` across kinds by water-filling: every kind is offered an equal share, a kind with fewer
 * rows than its share takes what it has, and the unused quota is handed to the kinds still wanting more.
 * The quotas sum to min(limit, total), so nothing under the cap is ever left out, and a store that fits
 * loads whole.
 *
 * Why not proportional shares: the store's shape is set by its machine feeds (every scan writes
 * episodic rows), so a proportional split repeats the recency cut's bias one level down. An equal offer
 * is what lets 3 procedural rows survive beside 500 episodic ones.
 */
export function planRecallLanes(countsByKind: Record<string, number>, limit: number): RecallLanePlan {
  const counts = Object.fromEntries(Object.entries(countsByKind).map(([k, n]) => [k, wholeCount(n)]));
  const quotas: Record<string, number> = Object.fromEntries(Object.keys(counts).map((k) => [k, 0]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  let remaining = Math.min(wholeCount(limit), total);

  // Deterministic order: thinnest kind first, name as the tie-break, so the leftover unit of an uneven
  // split always lands in the same place.
  let open = Object.keys(counts)
    .filter((k) => counts[k]! > 0)
    .sort((a, b) => counts[a]! - counts[b]! || a.localeCompare(b));

  while (remaining > 0 && open.length > 0) {
    const share = Math.floor(remaining / open.length);
    if (share === 0) {
      // Fewer units left than kinds wanting them: one each, in order, until they run out.
      for (const k of open.slice(0, remaining)) quotas[k]! += 1;
      remaining = 0;
      break;
    }
    const stillWanting: string[] = [];
    for (const k of open) {
      const give = Math.min(counts[k]! - quotas[k]!, share);
      quotas[k]! += give;
      remaining -= give;
      if (quotas[k]! < counts[k]!) stillWanting.push(k);
    }
    open = stillWanting;
  }

  const taken = Object.values(quotas).reduce((a, b) => a + b, 0);
  return { quotas, notConsidered: total - taken };
}

/**
 * The forget pass's population: the three ROW-LEVEL conditions of decay.ts's conjunction (kind,
 * confidence, age). The other two (decayed score, notUsefulCount floor) are judged by decay.ts itself
 * over what this loads, so the verdict and its tests are untouched; only the rows it is shown change.
 */
export function decayPopulationWhere(nowMs: number): Prisma.OrgMemoryWhereInput {
  return {
    kind: { notIn: [...DECAY_EXEMPT_KINDS] },
    confidence: { lte: DECAY_MAX_CONFIDENCE },
    updatedAt: { lt: new Date(nowMs - DECAY_MIN_AGE_DAYS * MS_PER_DAY) },
  };
}

/** Oldest first: the rows that have decayed longest are the ones a capped pass should reach first. */
export const DECAY_POPULATION_ORDER = { updatedAt: "asc" } as const satisfies Prisma.OrgMemoryOrderByWithRelationInput;
