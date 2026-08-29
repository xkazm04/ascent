// The UsageEvent ledger — one row per metered model call, for every lane that did not already have a
// ledger of its own.
//
// SCOPE, stated first because the omission is deliberate: the `scan` lane is NOT mirrored here. A
// computed scan already persists exactly one `Scan` row carrying its provider, model and token counts,
// and that row is the authoritative billable unit. Mirroring it would give the one lane that is
// already accounted a second, drift-prone ledger — and would force this module into
// `src/lib/db/scans-persist.ts`. `getUsageSummary` therefore UNIONs the Scan-derived `scan` lane with
// the UsageEvent-derived rest (see src/lib/db/usage.ts).
//
// WRITE POSTURE. `recordUsageEvent` is best-effort on `bumpCounter`'s guard-and-swallow skeleton: a
// no-op when persistence is off, and every error swallowed — including the P2002 a retried write hits
// on `idemKey`, which is exactly the at-least-once collision the unique index exists to absorb. An
// observability write must never break the surface it observes.
//
// HONEST NULLS. Token and cost columns are nullable and are written `null`, never `0`, when the
// provider reported nothing or the call cannot be priced (BYOM, a zero-cost provider, an unknown
// model). The readers preserve that: a lane's `estimatedCostUsd` is `null` when nothing in it could be
// priced, and `unpricedCalls` reports how many calls that was — so a $0.00 line reads as "nothing to
// price" rather than "free".

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { bumpCounter } from "@/lib/db/best-effort";
import { getOrgId } from "@/lib/db/org-rollup";
import { isUsageLane, type UsageEventInput, type UsageLane } from "@/lib/llm/meter";

/** One persisted metered call, as it crosses to a client. `createdAt` is an ISO STRING — the wire
 *  never carries a `Date` (src/lib/db/wire-safe-dates.test.ts). */
export interface UsageEventRow {
  id: string;
  lane: string;
  legKind: string | null;
  refId: string | null;
  repoFullName: string | null;
  teamKey: string | null;
  provider: string;
  model: string;
  byom: boolean | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: number | null;
  status: string;
  latencyMs: number | null;
  createdAt: string;
}

/** Per-lane spend within a window. `inputTokens`/`outputTokens`/`estimatedCostUsd` are `null` when
 *  NOTHING in the lane reported the figure — the lane ran, we just cannot say what it cost. */
export interface LaneUsage {
  lane: UsageLane;
  calls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  /** Calls whose cost could not be established (BYOM, a zero-cost provider, an unpriced model, or a
   *  provider that reported no usage at all). Reported so a $0 lane is readable as "nothing to price". */
  unpricedCalls: number;
}

/** Per-team spend within a window. `teamKey === null` is the explicit "org-wide work" bucket — never a
 *  dropped row. `label` is what a panel prints. */
export interface TeamUsage {
  teamKey: string | null;
  label: string;
  calls: number;
  estimatedCostUsd: number | null;
}

/** The label a team-less bucket carries. One constant so the panel, the CSV and the tests agree. */
export const ORG_WIDE_TEAM_LABEL = "Org-wide (no repo)";

/** USD from the stored micros, or null when nothing in the group was priceable. */
function usdFromMicros(micros: number | null | undefined): number | null {
  return micros == null ? null : micros / 1_000_000;
}

/**
 * Persist one metered call. Best-effort: skipped when persistence is off or the slug matches no org
 * (an event we cannot attribute is not written), and every error swallowed.
 *
 * The org lookup is what makes a slug-keyed seam safe to call from anywhere: callers hold slugs, the
 * ledger holds ids, and neither has to know the other's shape.
 */
export async function recordUsageEvent(event: UsageEventInput): Promise<void> {
  if (!isDbConfigured()) return;
  const orgId = await getOrgId(event.orgSlug).catch(() => null);
  if (!orgId) return;
  await bumpCounter(() =>
    getPrisma().usageEvent.create({
      data: {
        orgId,
        lane: event.lane,
        legKind: event.legKind ?? null,
        refId: event.refId ?? null,
        repoId: event.repoId ?? null,
        repoFullName: event.repoFullName ?? null,
        teamKey: event.teamKey ?? null,
        provider: event.provider,
        model: event.model,
        byom: event.byom ?? null,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheReadTokens: event.cacheReadTokens,
        cacheWriteTokens: event.cacheWriteTokens,
        costMicros: event.costMicros,
        status: event.status,
        latencyMs: event.latencyMs ?? null,
        idemKey: event.idemKey ?? null,
      },
    }),
  );
}

/**
 * Per-lane totals over the half-open window `[since, before)` — the SAME window bounds the rest of the
 * usage summary uses. The bound is load-bearing and is never re-derived here: a second derivation is
 * how a headline tile and its own chart start disagreeing.
 *
 * The `scan` lane is absent by construction (see the module header); `getUsageSummary` supplies it.
 */
export async function laneTotals(orgSlug: string, since: Date, before: Date): Promise<LaneUsage[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const prisma = getPrisma();
  const where = { orgId, createdAt: { gte: since, lt: before } };
  const [groups, unpriced] = await Promise.all([
    prisma.usageEvent.groupBy({
      by: ["lane"],
      where,
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, costMicros: true },
    }),
    prisma.usageEvent.groupBy({ by: ["lane"], where: { ...where, costMicros: null }, _count: true }),
  ]);
  const unpricedByLane = new Map(unpriced.map((g) => [g.lane, g._count]));
  return groups
    // A row whose lane string is not in the vocabulary is data from a future (or rolled-back) version.
    // Drop it from the typed view rather than widening `UsageLane` at runtime.
    .filter((g) => isUsageLane(g.lane))
    .map((g) => ({
      lane: g.lane as UsageLane,
      calls: g._count,
      inputTokens: g._sum.inputTokens,
      outputTokens: g._sum.outputTokens,
      estimatedCostUsd: usdFromMicros(g._sum.costMicros),
      unpricedCalls: unpricedByLane.get(g.lane) ?? 0,
    }));
}

/**
 * Per-team totals over the same half-open window. A row with no `teamKey` lands in the explicit
 * `null` bucket — the work was org-wide (a briefing, a memory pass), which is an answer, not a gap.
 */
export async function teamTotals(orgSlug: string, since: Date, before: Date): Promise<TeamUsage[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const groups = await getPrisma().usageEvent.groupBy({
    by: ["teamKey"],
    where: { orgId, createdAt: { gte: since, lt: before } },
    _count: true,
    _sum: { costMicros: true },
  });
  return groups.map((g) => ({
    teamKey: g.teamKey,
    label: g.teamKey ?? ORG_WIDE_TEAM_LABEL,
    calls: g._count,
    estimatedCostUsd: usdFromMicros(g._sum.costMicros),
  }));
}

/** The newest metered calls for an org — the audit read behind "what did the companion actually do".
 *  `UsageEvent` IS the audit row for spend (one `AuditLog` entry per model call would drown the trail),
 *  so this is the door to it. */
export async function listUsageEvents(orgSlug: string, limit = 50): Promise<UsageEventRow[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const rows = await getPrisma().usageEvent.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: Math.min(500, Math.max(1, Math.floor(limit))),
  });
  return rows.map((r) => ({
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
    // ISO string, server-side — the wire type declares `string` and this is where that becomes true.
    createdAt: r.createdAt.toISOString(),
  }));
}
