// THE CALLS DRILL-IN READ - the UsageEvent rows behind one spend figure on /usage.
//
// Every figure on /usage (a lane's unpriced count, a repo row, a showback cell) is a fold over the
// UsageEvent ledger in the half-open window `[since, before)`. This read returns the rows of ONE such
// fold, over the SAME window the page resolved once, so the panel lists the calls the figure counted
// and not a neighbouring set. It is the door `listUsageEvents` (usage-events.ts) was written to be,
// filtered and windowed.
//
// DISPLAY ONLY. Nothing here feeds a credit, a quota, a plan gate or a charge.
//
// SCOPE: the `scan` lane is not in this ledger (see the usage-events.ts header), so a scan filter
// reads no rows by construction and the panel says so.
//
// The unpriced half is read as GROUPS, not rows: the panel's per-reason breakdown must sum to the
// filter's whole unpriced count, not to the 50 rows it shows. A group is (provider, model, byom,
// tokens reported?) - exactly the inputs `priceCallGroup` (usage-pricing.ts) decides a reason from,
// so the breakdown is that rule applied per group, never a second classifier.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import type { UsageEventRow } from "@/lib/db/usage-events";
import type { UsageLane } from "@/lib/llm/meter";

/** Which figure's calls to open. `null` team / repo is the explicit org-wide bucket. */
export type CallsFilter =
  | { kind: "lane"; lane: UsageLane }
  | { kind: "team"; teamKey: string | null }
  | { kind: "repo"; repoFullName: string | null }
  | { kind: "cell"; lane: UsageLane; teamKey: string | null }
  | { kind: "unpriced" };

/** Unpriced calls sharing every input the pricing rule reads. */
export interface UnpricedGroup {
  provider: string;
  model: string;
  byom: boolean | null;
  /** False when every call in the group reported no tokens (null or 0 on both sides). */
  tokensReported: boolean;
  calls: number;
}

export interface LedgerCalls {
  /** The most expensive calls first (unpriced last), newest first within a cost. At most 50. */
  rows: UsageEventRow[];
  /** Every call the filter matched in the window - the figure the panel opened. */
  calls: number;
  unpricedGroups: UnpricedGroup[];
}

export const LEDGER_CALLS_LIMIT = 50;

/** The Prisma `where` for a filter. Exported for the test. */
export function callsWhere(orgId: string, filter: CallsFilter, since: Date, before: Date) {
  const base = { orgId, createdAt: { gte: since, lt: before } };
  switch (filter.kind) {
    case "lane":
      return { ...base, lane: filter.lane };
    case "team":
      return { ...base, teamKey: filter.teamKey };
    case "repo":
      return { ...base, repoFullName: filter.repoFullName };
    case "cell":
      return { ...base, lane: filter.lane, teamKey: filter.teamKey };
    case "unpriced":
      return { ...base, costMicros: null };
  }
}

const NO_TOKENS = {
  AND: [
    { OR: [{ inputTokens: null }, { inputTokens: 0 }] },
    { OR: [{ outputTokens: null }, { outputTokens: 0 }] },
  ],
};

const EMPTY: LedgerCalls = { rows: [], calls: 0, unpricedGroups: [] };

/** The calls behind one figure over `[since, before)`. Empty when persistence is off or no such org. */
export async function listLedgerCalls(
  orgSlug: string,
  filter: CallsFilter,
  since: Date,
  before: Date,
): Promise<LedgerCalls> {
  if (!isDbConfigured()) return EMPTY;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return EMPTY;
  const where = callsWhere(orgId, filter, since, before);
  const unpricedWhere = { ...where, costMicros: null };
  const by = ["provider", "model", "byom"] as const;
  const prisma = getPrisma();
  const [rows, calls, unpriced, silent] = await Promise.all([
    prisma.usageEvent.findMany({
      where,
      orderBy: [{ costMicros: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: LEDGER_CALLS_LIMIT,
    }),
    prisma.usageEvent.count({ where }),
    prisma.usageEvent.groupBy({ by: [...by], where: unpricedWhere, _count: { _all: true } }),
    prisma.usageEvent.groupBy({ by: [...by], where: { ...unpricedWhere, ...NO_TOKENS }, _count: { _all: true } }),
  ]);
  const key = (g: { provider: string; model: string; byom: boolean | null }) => `${g.provider}\u0000${g.model}\u0000${g.byom}`;
  const silentBy = new Map(silent.map((g) => [key(g), g._count._all]));
  const unpricedGroups: UnpricedGroup[] = [];
  for (const g of unpriced) {
    const none = Math.min(g._count._all, silentBy.get(key(g)) ?? 0);
    const base = { provider: g.provider, model: g.model, byom: g.byom };
    if (none > 0) unpricedGroups.push({ ...base, tokensReported: false, calls: none });
    if (g._count._all > none) unpricedGroups.push({ ...base, tokensReported: true, calls: g._count._all - none });
  }
  return {
    rows: rows.map((r) => ({
      id: r.id,
      lane: r.lane,
      legKind: r.legKind,
      refId: r.refId,
      repoFullName: r.repoFullName,
      teamKey: r.teamKey,
      provider: r.provider,
      model: r.model,
      byom: r.byom,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costMicros: r.costMicros,
      status: r.status,
      latencyMs: r.latencyMs,
      // ISO string, server-side: the wire type declares `string` (wire-safe-dates.test.ts).
      createdAt: r.createdAt.toISOString(),
    })),
    calls,
    unpricedGroups,
  };
}
