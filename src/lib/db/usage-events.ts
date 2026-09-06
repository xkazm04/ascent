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
// TYPE-ONLY, and load-bearing: a RUNTIME import of `@/lib/llm/meter` here would put the whole llm
// module graph under the `@/lib/db` barrel, which every route and page already imports. That extra
// depth is enough to change module INITIALIZATION ORDER inside the existing `auth.ts` ↔ `authz.ts`
// cycle, and the symptom is a "Cannot access '...' before initialization" that appears in unrelated
// tests, intermittently. The meter imports THIS module lazily for the same family of reason
// (`build-not-in-gate`), so the dependency runs one way only, and at runtime only.
import type { UsageEventInput, UsageLane } from "@/lib/llm/meter";

/** The lane vocabulary, restated for the runtime check below. Kept in sync by a compile-time
 *  assertion rather than by discipline: a lane added to `UsageLane` and not here fails `tsc`. */
const LANES = ["scan", "athena", "memory", "briefing", "local"] as const;
const _laneVocabularyIsComplete: UsageLane extends (typeof LANES)[number]
  ? (typeof LANES)[number] extends UsageLane
    ? true
    : ["a lane in this list is not a UsageLane"]
  : ["a UsageLane is missing from LANES"] = true;
void _laneVocabularyIsComplete;

/** Whether a persisted lane string is one this build knows. A row from a future (or rolled-back)
 *  version is data, not a type — it is dropped from the typed view rather than widening it.
 *  Exported for `usage-showback.ts`, which must bucket an unrecognized lane EXACTLY as this module
 *  does — a second copy of the rule is how two panels on one page start disagreeing (MC-B31). */
export function isUsageLane(v: string | null | undefined): v is UsageLane {
  return v != null && (LANES as readonly string[]).includes(v);
}

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

/**
 * The `lane` key a usage row is reported under: one of this build's lanes, or the explicit
 * `"unknown"` bucket.
 *
 * UAT MC-B31 (VICTOR-L1-08): `laneTotals` used to DROP a row whose lane string this build does not
 * know, while `teamTotals` — which groups the same rows by team and never looks at `lane` — kept
 * counting it. Two panels on one page could therefore disagree about the same call total with nothing
 * on screen to explain the gap. A row from a future (or rolled-back) version is still real spend, so
 * it is now folded into ONE disclosed bucket rather than silently deleted from the ledger's own view.
 */
export const UNKNOWN_LANE = "unknown" as const;
export type LaneKey = UsageLane | typeof UNKNOWN_LANE;

/** Per-lane spend within a window. `inputTokens`/`outputTokens`/`estimatedCostUsd` are `null` when
 *  NOTHING in the lane reported the figure — the lane ran, we just cannot say what it cost. */
export interface LaneUsage {
  lane: LaneKey;
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

/** The label a team-less bucket carries. One constant so the panel, the CSV and the tests agree.
 *  Shared with the per-REPO view, whose repo-less bucket is the same fact seen one level finer. */
export const ORG_WIDE_TEAM_LABEL = "Org-wide (no repo)";

/**
 * Per-REPO spend within a window, from the `UsageEvent` ledger.
 *
 * `repoFullName === null` is the explicit org-wide bucket — a briefing, an org-wide memory pass —
 * never a dropped row, exactly as `teamKey === null` is in {@link TeamUsage}. A repo is the finest
 * attribution this ledger carries and the finest it ever will: `teamKey` is a CODEOWNERS team and
 * `repoFullName` a repository, and per-PERSON attribution is ruled out by
 * docs/features/billing/usage.md's privacy note.
 */
export interface RepoEventUsage {
  repoFullName: string | null;
  calls: number;
  /** `null` when NOTHING in the repo's calls could be priced — never rendered as $0.00. When only
   *  SOME could, this is a floor and `unpricedCalls` says by how many calls. */
  estimatedCostUsd: number | null;
  unpricedCalls: number;
}

/** USD from the stored micros, or null when nothing in the group was priceable. Exported so the
 *  showback matrix converts micros by the same rule — null is "not priced", never 0. */
export function usdFromMicros(micros: number | null | undefined): number | null {
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
  const org = await getUsageLedgerOrg(event.orgSlug);
  if (!org) return;
  const orgId = org.id;
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
 * The org row this event lands in, or `null` when there is no ledger for it.
 *
 * WHERE THE "DON'T METER THIS ORG" DECISION LIVES (UAT MC-B20). It used to live in `meter()`, as
 * `orgSlug === "public"` — the anonymous funnel's sentinel, applied as a string. A tenant whose slug
 * was that string therefore burned real inference and showed $0 forever, silently. The question the
 * meter was really asking is a property of the ORG, not of the spelling of its slug, so it is asked
 * HERE, where the row is in hand: an org row flavored `kind: "public"` is the shared anonymous funnel
 * and is not ledgered; anything else is a tenant and is.
 *
 * `Organization.kind` is the tenant-flavor column ("org" | "personal" today). A deployment that wants
 * its funnel org excluded stamps it `public`; an unstamped deployment simply meters everything it can
 * attribute, which is the honest default — the funnel's own scans never reach this ledger anyway (the
 * scan lane keeps its own, see the module header).
 */
async function getUsageLedgerOrg(slug: string): Promise<{ id: string } | null> {
  const org = await getPrisma()
    .organization.findUnique({ where: { slug }, select: { id: true, kind: true } })
    .catch(() => null);
  if (!org) return null;
  return org.kind === UNMETERED_ORG_KIND ? null : { id: org.id };
}

/**
 * The CODEOWNERS default-owner team slug for a repo, or `null` when it has none — the `teamKey` a
 * caller stamps on its own metered events.
 *
 * UAT MC-B19 (VICTOR-L1-04): "Spend by team" read 100 % "Org-wide" for every non-scan lane, because
 * the lanes that DO know their repo never resolved its owning team, while the scan lane's split
 * (`scanTeamUsage`, src/lib/db/usage.ts) did the same join and reported real teams. One panel,
 * two attribution qualities, no way for a reader to tell which rows were which.
 *
 * A LEFT join like that one: a repo with no default owner is org-wide, which is an answer, not a gap.
 * Best-effort — attribution is observability, and a failed lookup degrades to org-wide rather than
 * costing the caller its ledger row.
 */
export async function defaultOwnerTeamForRepo(orgSlug: string, repoFullName: string): Promise<string | null> {
  if (!isDbConfigured() || !repoFullName) return null;
  const orgId = await getOrgId(orgSlug).catch(() => null);
  if (!orgId) return null;
  const repo = await getPrisma()
    .repository.findFirst({
      where: { orgId, fullName: repoFullName },
      select: { teams: { where: { isDefaultOwner: true }, select: { slug: true }, take: 1 } },
    })
    .catch(() => null);
  return repo?.teams[0]?.slug ?? null;
}

/** `Organization.kind` of the shared anonymous funnel: an org with no tenant to bill, whose model
 *  calls are deliberately not ledgered. See {@link getUsageLedgerOrg}. */
export const UNMETERED_ORG_KIND = "public";

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
  const rows: LaneUsage[] = [];
  // A row whose lane string is not in this build's vocabulary is data from a future (or rolled-back)
  // version. It is NOT widened into `UsageLane` — but nor is it dropped (MC-B31): its calls are real
  // and `teamTotals` counts them, so dropping them here made two panels on one page contradict each
  // other. Everything unrecognized folds into one explicit `unknown` bucket the UI names out loud.
  let unknown: LaneUsage | null = null;
  for (const g of groups) {
    const cost = usdFromMicros(g._sum.costMicros);
    const unpricedCalls = unpricedByLane.get(g.lane) ?? 0;
    if (isUsageLane(g.lane)) {
      rows.push({
        lane: g.lane,
        calls: g._count,
        inputTokens: g._sum.inputTokens,
        outputTokens: g._sum.outputTokens,
        estimatedCostUsd: cost,
        unpricedCalls,
      });
      continue;
    }
    unknown = unknown
      ? {
          lane: UNKNOWN_LANE,
          calls: unknown.calls + g._count,
          inputTokens: sumOrNull(unknown.inputTokens, g._sum.inputTokens),
          outputTokens: sumOrNull(unknown.outputTokens, g._sum.outputTokens),
          // Same refusal the rest of the module makes: a side with calls and no price is UNKNOWN, and
          // unknown + known is still unknown. Adding only the priced half would print a confident
          // figure that omits real spend.
          estimatedCostUsd:
            unknown.estimatedCostUsd == null || cost == null ? null : unknown.estimatedCostUsd + cost,
          unpricedCalls: unknown.unpricedCalls + unpricedCalls,
        }
      : {
          lane: UNKNOWN_LANE,
          calls: g._count,
          inputTokens: g._sum.inputTokens,
          outputTokens: g._sum.outputTokens,
          estimatedCostUsd: cost,
          unpricedCalls,
        };
  }
  if (unknown) rows.push(unknown);
  return rows;
}

/** Token sums across two groups: `null` (not reported) never becomes 0 — see the module header. */
function sumOrNull(a: number | null, b: number | null | undefined): number | null {
  if (a == null) return b ?? null;
  return b == null ? a : a + b;
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

/**
 * Per-repo totals over the same half-open window `[since, before)` the lane and team reads use.
 *
 * ONE query, not the two `laneTotals` needs: the unpriced count rides along as a per-FIELD `_count`
 * (`costMicros` counts only non-null values), so `_all - costMicros` is the number of calls no basis
 * could price without a second groupBy over `costMicros: null`.
 *
 * A row with no `repoFullName` lands in the explicit `null` bucket. Every lane that knows the repo it
 * worked stamps it at write time (`src/lib/llm/meter.ts`), so this is the per-repo half of the money
 * the lane/team panels already show — not a new measurement.
 */
export async function repoTotals(orgSlug: string, since: Date, before: Date): Promise<RepoEventUsage[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const groups = await getPrisma().usageEvent.groupBy({
    by: ["repoFullName"],
    where: { orgId, createdAt: { gte: since, lt: before } },
    _count: { _all: true, costMicros: true },
    _sum: { costMicros: true },
  });
  return groups.map((g) => ({
    repoFullName: g.repoFullName,
    calls: g._count._all,
    estimatedCostUsd: usdFromMicros(g._sum.costMicros),
    // Priced rows are the ones with a non-null costMicros; the rest ran and could not be costed.
    unpricedCalls: Math.max(0, g._count._all - g._count.costMicros),
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
