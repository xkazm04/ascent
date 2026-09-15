// Usage metering. Pricing is usage-based (per private scan), and each *computed* scan
// persists exactly one Scan row (cache hits don't persist), so Scan rows are the
// authoritative metered unit. This module aggregates them into a billing/usage summary
// per organization and period. (Per-org attribution becomes meaningful once auth / the
// GitHub App lands; until then everything is under the "public" org.)

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { isZeroCostProvider, priceForModel } from "@/lib/llm/config";
import {
  ORG_WIDE_TEAM_LABEL,
  laneTotals,
  repoTotals,
  teamTotals,
  type LaneUsage,
  type RepoEventUsage,
  type TeamUsage,
} from "@/lib/db/usage-events";

import { laneTeamTotals, mergeLaneTeamCells, type LaneTeamCell } from "@/lib/db/usage-showback";

export type { LaneUsage, TeamUsage } from "@/lib/db/usage-events";
export type { LaneTeamCell } from "@/lib/db/usage-showback";

/** The shared anonymous funnel's slug (the value of `PUBLIC_ORG` in `@/lib/auth`, restated here so a
 *  db module does not reach into the auth layer). It has no tenant, no teams and no bill. */
const PUBLIC_ORG_SLUG = "public";

export interface ProviderUsage {
  provider: string;
  count: number;
}

/**
 * Per-repo METERED usage within the period — which repos drove the bill, in scans AND in dollars.
 *
 * A UNION of the same two sources `byLane` and `byTeam` union, one level finer than `teamKey`: the
 * BILLABLE `Scan` groups (scans, tokens, the scan lane's priced cost) and the `UsageEvent` ledger's
 * `repoFullName` (every other lane's calls and cost). `scans`/`tokens` therefore describe the scan
 * lane alone — a repo can carry Athena or local-agent spend with no billable scan behind it — while
 * `calls` and `estimatedCostUsd` describe every metered call attributed to the repo.
 */
export interface RepoUsage {
  /** `null` is the explicit org-wide bucket (a briefing, an org-wide memory pass): work that has no
   *  repo is counted, never dropped, exactly as `teamKey === null` is in `TeamUsage`. */
  fullName: string | null;
  /** What a panel prints — the repo's full name, or the org-wide bucket's shared label. */
  label: string;
  /** BILLABLE computed scans (the `isBillableScan` predicate) — the panel's sort key, as before. */
  scans: number;
  tokens: number; // input + output, scan lane
  /** Metered calls attributed to this repo across EVERY lane: its billable scans plus its ledger rows. */
  calls: number;
  /** Estimated cost across those calls. `null` — never `0` — when a side that HAS calls could not be
   *  priced: unknown + known is still unknown (the `mergeTeamUsage` rule, applied one level finer).
   *  BYOM is excluded from pricing, so a BYOM-only repo reads "no estimate", not a free month. */
  estimatedCostUsd: number | null;
  /** Calls in the row that no basis could price — what makes a null (or a short) figure readable. */
  unpricedCalls: number;
}

/** One day's computed-scan counts, split billable (metered) vs free (everything else). */
export interface UsageDay {
  date: string; // YYYY-MM-DD (UTC)
  billable: number;
  free: number;
}

/**
 * The engineProvider value for a keyless/degraded run: no Ascent-metered inference happened, so the
 * scan cost nothing to serve. Shared with credits.ts's allowance basis (`engineProvider: { not: "mock" }`).
 */
const UNMETERED_PROVIDER = "mock";

/**
 * THE billable predicate — the ONE definition of "this scan consumed Ascent-metered inference and is
 * therefore a billable unit". A scan is billable only when it is (a) a PRIVATE repo (public scans are
 * free by policy) AND (b) it ran on Ascent's own metered provider: not the keyless `mock` engine (no
 * inference at all) and not the org's own BYOM provider (the org already paid its vendor directly).
 *
 * Previously the per-day series bucketed on `repo.isPrivate` alone, so a private mock/BYOM scan was
 * drawn as billable volume in the trend chart and the finance CSV while the dollar-cost path
 * (estimateLlmCostFromTable) already skipped token-less rows — the chart overstated the bill.
 *
 * Every path that splits billable vs free MUST go through this function, `billableScanWhere` (the
 * Prisma form) or the `billable` expression in fetchDailySeries' raw SQL — all three encode the same
 * three clauses, and drift between the SQL path and the JS fallback is the root of this bug class.
 * `engineByom` is nullable (rows predating the column): UNKNOWN provenance means Ascent's platform
 * account, so only an explicit `true` de-meters a scan — matching the report header's wording rule.
 */
export function isBillableScan(scan: {
  isPrivate: boolean;
  engineProvider: string;
  engineByom?: boolean | null;
}): boolean {
  return scan.isPrivate && scan.engineProvider !== UNMETERED_PROVIDER && scan.engineByom !== true;
}

/** The Prisma-`where` form of {@link isBillableScan}, for the headline count + the byRepo attribution. */
function billableScanWhere(orgId: string) {
  return {
    repo: { orgId, isPrivate: true },
    engineProvider: { not: UNMETERED_PROVIDER },
    // Nullable column: `null` (unknown) counts as Ascent-metered, so match false OR null explicitly
    // rather than relying on driver-specific `not: true` NULL semantics.
    OR: [{ engineByom: false }, { engineByom: null }],
  };
}

export interface UsageSummary {
  org: string;
  /** True when this org is the shared anonymous funnel — derived from the org ROW's kind (the same
   *  fact the meter's skip decision reads, RC3-N2), with the slug as the only no-row fallback. */
  unmeteredFunnel: boolean;
  periodDays: number;
  /** All-time computed-scan count for the org. */
  totalScans: number;
  /** Computed scans within the last `periodDays`. */
  periodScans: number;
  /** BILLABLE computed scans within the last `periodDays` — see isBillableScan (private AND metered).
   *  Named `private*` for historical/wire compatibility; a private mock/BYOM scan is NOT counted. */
  privateScans: number;
  /** FREE computed scans within the last `periodDays` — `periodScans - privateScans`, i.e. public
   *  scans plus private scans that consumed no Ascent-metered inference (mock / BYOM). Derived, not
   *  queried, so `privateScans + publicScans === periodScans` and the headline tiles equal the trend
   *  chart's totals BY CONSTRUCTION (same predicate, same window bounds as `daily`). */
  publicScans: number;
  /** All-time count of distinct repos scanned. */
  distinctRepos: number;
  /** Provider mix within the last `periodDays`. */
  byProvider: ProviderUsage[];
  /** Per-day series across the period (oldest → newest), for the trend chart + export. */
  daily: UsageDay[];
  /** LLM tokens consumed within the period (sum across scans). */
  inputTokens: number;
  outputTokens: number;
  /** Estimated LLM cost (USD) within the period. Basis precedence: the configured env rates
   *  (LLM_INPUT_COST_PER_MTOK / LLM_OUTPUT_COST_PER_MTOK — a global override) win when both are
   *  set; otherwise the built-in per-model price table (MODEL_PRICES) prices each model's tokens
   *  at its own approximate list rate, so mixed-provider fleets aren't all billed at one number.
   *  Null when neither basis can price the period's tokens — show "no estimate", never a fake $. */
  estimatedCostUsd: number | null;
  /** Which basis produced estimatedCostUsd: operator-configured env rates, the built-in
   *  approximate table, or null when there is no estimate. Drives the UI's labeling. */
  costBasis: "env" | "builtin" | null;
  /** Top repos by METERED (private) scan volume within the period, with their token spend AND their
   *  DOLLAR spend across every lane. Scan volume is scoped private-only to match the
   *  "metered/billable" framing — free public scans are excluded, so the attribution answers "which
   *  repos drove the bill", not raw volume. The cost merges the scan lane's priced fold with the
   *  `UsageEvent` ledger's `repoFullName` totals under the `mergeTeamUsage` rule (unknown + known is
   *  unknown), and work with no repo is the explicit last row rather than a dropped one. */
  byRepo: RepoUsage[];
  /**
   * Spend per INFERENCE LANE within the period — scan, Athena, org memory, briefing, local agent.
   *
   * A UNION of two sources, not one ledger: the `scan` lane is derived from `Scan` rows (which are
   * already the authoritative billable unit, so mirroring them into `UsageEvent` would create a
   * second, drift-prone copy) and every other lane comes from `UsageEvent` over the SAME half-open
   * window. Lanes that did nothing in the period are absent — an empty lane is not a zero.
   */
  byLane: LaneUsage[];
  /**
   * Spend per repo TEAM (the CODEOWNERS default owner), so an operator can answer "which team's work
   * drives the bill". A team is never a person: see the privacy note in docs/features/billing/usage.md.
   * Empty for the public funnel, which has no teams to attribute to.
   */
  byTeam: TeamUsage[];
  /**
   * Spend at the INTERSECTION of a lane and a team — the join `byLane` and `byTeam` cannot make
   * between them, and the matrix spec #11 promised (MC-B45).
   *
   * SPARSE: one entry per (lane, team) pair that actually recorded calls. A missing pair is BLANK,
   * never a zero — absence of a record is not evidence a team spent nothing on a lane. The `scan`
   * lane's cells come from the same Scan-derived fold that produces `byTeam`'s scan half, so the
   * matrix and both tables above it reconcile by construction. Empty for the public funnel.
   */
  byLaneTeam: LaneTeamCell[];
  /**
   * Estimated cost across EVERY lane in `byLane` — the number the headline tile shows.
   *
   * `estimatedCostUsd` above prices the scan lane alone, because that is the billable unit and the
   * only lane derived from `Scan` rows. Showing it as *the* cost understated the page's own
   * itemization the moment any other lane spent money (UAT VICTOR-L1-05, live-confirmed in arm B of
   * the 2026-08-30 moonshot cert on `/usage?org=kiro`: a $25.90 headline over a
   * $115.28 lane table — a 78% understatement in the first number a FinOps reader sees). This is
   * the sum the lane table sums to, so headline and itemization agree by construction.
   *
   * Null only when NOTHING in the period could be priced (every lane's estimate is null) — a lane
   * that could not be priced never contributes a silent $0; it contributes to
   * `allLanesUnpricedCalls` instead, so the headline reads as a floor rather than a total.
   */
  allLanesCostUsd: number | null;
  /** Calls across every lane that could not be priced (unknown model, BYOM, or no tokens reported).
   *  Non-zero means `allLanesCostUsd` is a FLOOR — the headline must say so. */
  allLanesUnpricedCalls: number;
  /**
   * Computed scans in the period that ran BYOM — in the ORG'S OWN provider account.
   *
   * Their tokens are counted in `inputTokens`/`outputTokens` (they were really consumed) but are
   * excluded from every dollar figure on this page, because the org paid its own vendor for them and
   * Ascent has no figure. Reported separately so the estimate can say WHY it covers less than the
   * volume beside it, instead of leaving a reader to assume the difference was free.
   */
  byomScans: number;
  firstScanAt: string | null;
  lastScanAt: string | null;
  /**
   * The half-open window every period figure above was computed over, echoed as ISO strings so a
   * reader (or a downstream sheet) never has to reconstruct it from `periodDays` and a local clock.
   * `windowBefore` is EXCLUSIVE: it is midnight UTC of tomorrow, not "now".
   */
  windowSince: string;
  windowBefore: string;
  /**
   * The start of the window actually COVERED by the daily series: `windowSince`, or the org's first
   * scan day when the requested window reaches back before the org existed (see clampDailySeries).
   * When this differs from `windowSince` the page says the window was shortened, rather than drawing
   * measured zeros for days nobody was watching.
   */
  effectiveSince: string;
  /** Days in `daily` after that clamp — `periodDays` unless the window was shortened. */
  effectiveDays: number;
  /**
   * The timezone EVERY date on this response is expressed in. Day bucketing, the window bounds and
   * the axis keys are all UTC (`date_trunc('day', ...)` server-side, `toISOString().slice(0,10)` in
   * JS); a reader in UTC-8 whose "yesterday" straddles two of these buckets needs to be told which
   * calendar they are looking at. Constant by construction, and stated rather than assumed.
   */
  timezone: "UTC";
}

/**
 * Fold `byLane` into the headline pair: the summed estimate and the count of calls no basis could
 * price. Exported for the test, and so the one definition of "the page's total" lives beside the
 * lane rows it must equal.
 */
export function foldLaneCost(byLane: LaneUsage[]): {
  allLanesCostUsd: number | null;
  allLanesUnpricedCalls: number;
} {
  let priced: number | null = null;
  let unpriced = 0;
  for (const l of byLane) {
    if (l.estimatedCostUsd != null) priced = (priced ?? 0) + l.estimatedCostUsd;
    unpriced += l.unpricedCalls;
    // A lane with calls and no estimate at all is itself unpriced volume the row already reports;
    // count it here too so the headline's floor qualifier can't be smaller than the itemization's.
    if (l.estimatedCostUsd == null && l.unpricedCalls === 0) unpriced += l.calls;
  }
  return { allLanesCostUsd: priced, allLanesUnpricedCalls: unpriced };
}

/**
 * Bound the caller-supplied `?days=` into the INTEGER window shared by the /usage page and the
 * /api/usage route — the SINGLE source both call so their `since`, day axis, and counts can't drift.
 *
 * The floor is load-bearing: a fractional `?days=` (e.g. 1.5) was carried through verbatim, and
 * `emptyDailySeries` then stepped the axis by fractional day offsets (i = 0.5), so the newest UTC day
 * never landed on a generated axis key. The `scan.count` headline still counted today's scans (it keys
 * off the same `since`), so the trend chart + finance CSV silently UNDER-reported the newest day while
 * the "Last Nd" stat over it — chart/export disagreeing with the headline. Flooring BEFORE the `|| 30`
 * fallback collapses 1.5 → 1; a value < 1 (0.5) falls through to the 30 default. The public funnel is
 * capped tighter (90d) so an anonymous caller can't force the 365-day full-window aggregate.
 */
export function boundUsageDays(raw: string | null | undefined, isPublic: boolean): number {
  return Math.min(isPublic ? 90 : 365, Math.max(1, Math.floor(Number(raw)) || 30));
}

/**
 * The half-open, UTC-day-anchored window every figure on /usage is computed over: `[since, before)`
 * where `since` is midnight UTC of the oldest day shown and `before` is midnight UTC of TOMORROW.
 *
 * Exported because a second reader of the same period — the credit reconciliation on the same page —
 * used to derive its own `Date.now() - days * 86_400_000` rolling wall-clock cutoff. Two windows of
 * DIFFERENT KINDS were labelled "last {days}d" side by side, and the panel blamed the resulting
 * difference on "rows straddling the window edge": a structural mismatch presented as incidental.
 * One helper, one window, or the two panels are not comparable.
 */
export interface UsageWindow {
  /** Inclusive lower bound: midnight UTC of the oldest day in the period. */
  since: Date;
  /** EXCLUSIVE upper bound: midnight UTC of tomorrow. Load-bearing — see the note in getUsageSummary. */
  before: Date;
}

/** Build {@link UsageWindow} for `periodDays` ending with the UTC day containing `nowMs`. */
export function usageWindow(periodDays: number, nowMs: number = Date.now()): UsageWindow {
  const todayUtcMs = utcDayStart(nowMs);
  return {
    since: new Date(todayUtcMs - (Math.max(1, Math.floor(periodDays)) - 1) * 86_400_000),
    before: new Date(todayUtcMs + 86_400_000),
  };
}

/**
 * Clamp the zero-filled day series at the org's FIRST scan.
 *
 * `emptyDailySeries` always emits `periodDays` rows, so a five-day-old org asked for `days=365`
 * rendered 360 days of *measured zeros* — and exported them to the finance CSV, where a zero is a
 * claim that nothing happened rather than that nothing was being watched. Absence of a record is not
 * evidence of no activity. The trimmed days are all-zero by construction (no scan can predate the
 * first scan), so this changes only what the page CLAIMS to have measured, never a count.
 *
 * Head-only: the tail is today, which the chart marks as partial rather than hides. An org with no
 * scans at all is left alone — its series is honestly all-zero and there is no first scan to clamp to.
 * Exported for the test.
 */
export function clampDailySeries(
  daily: UsageDay[],
  since: Date,
  firstScanAt: string | null,
): { daily: UsageDay[]; effectiveSince: string } {
  const requested = since.toISOString();
  if (!firstScanAt || daily.length === 0) return { daily, effectiveSince: requested };
  const firstDay = firstScanAt.slice(0, 10);
  const i = daily.findIndex((d) => d.date >= firstDay);
  if (i <= 0) return { daily, effectiveSince: requested }; // -1: first scan is future-dated; 0: no trim
  const trimmed = daily.slice(i);
  return { daily: trimmed, effectiveSince: `${trimmed[0]!.date}T00:00:00.000Z` };
}

export async function getUsageSummary(
  orgSlug = "public",
  periodDays = 30,
  /** The window to compute over. Defaults to `usageWindow(periodDays)`; a caller that must compute
   *  the SAME window for another read (the /usage page's credit reconciliation) passes its own. */
  window?: UsageWindow,
): Promise<UsageSummary | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  // Canonicalize the slug ONCE up front. Org slugs are canonically lowercase (authz + setOrgPlan /
  // credits.ts / the cap-panel logic on /usage all normalize), but this lookup used the raw `?org=`
  // value — so `/usage?org=Public` was treated as the public org by the page yet missed the `public`
  // row here and rendered an empty "no scans metered yet" summary despite real data. Normalize so the
  // DB lookup agrees with every downstream check; /api/usage shares this path, so it's fixed too.
  const slug = orgSlug.trim().toLowerCase();

  // ONE window helper, shared with every other reader of this period (see usageWindow).
  const win = window ?? usageWindow(periodDays);
  const { since, before } = win;

  const empty: UsageSummary = {
    org: slug,
    unmeteredFunnel: slug === "public",
    periodDays,
    totalScans: 0,
    periodScans: 0,
    privateScans: 0,
    publicScans: 0,
    distinctRepos: 0,
    byProvider: [],
    daily: emptyDailySeries(periodDays),
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: null,
    costBasis: null,
    byRepo: [],
    byLane: [],
    byTeam: [],
    byLaneTeam: [],
    allLanesCostUsd: null,
    allLanesUnpricedCalls: 0,
    byomScans: 0,
    firstScanAt: null,
    lastScanAt: null,
    windowSince: since.toISOString(),
    windowBefore: before.toISOString(),
    effectiveSince: since.toISOString(),
    effectiveDays: periodDays,
    timezone: "UTC",
  };

  const orgRow = await prisma.organization.findUnique({ where: { slug }, select: { id: true, kind: true } });
  if (!orgRow) return empty;
  const orgId = orgRow.id;
  const unmeteredFunnel = orgRow.kind === "public";

  // The window is anchored to UTC calendar days (usageWindow). `since` is the START of the oldest day
  // shown on the chart, derived from the SAME UTC-day floor the axis uses (emptyDailySeries) — so
  // every counted scan's UTC date is guaranteed to land on a generated axis day. The previous code
  // stepped the axis from a LOCAL `new Date()` while keying buckets by UTC date, so near-midnight-UTC
  // scans fell into the idx-miss gap and were silently dropped (under-reporting billable volume).
  //
  // The UPPER bound is exclusive — the end of TODAY's UTC day, the same edge the generated day axis
  // stops at. Without it the period counts were open-ended while the series index only spans
  // since→today, so a future-dated / clock-skewed scan was counted in the headline Stat tile yet
  // silently idx-missed out of the chart and CSV (`idx.get(row.day)` undefined → row dropped) — the
  // headline and the trend total disagreeing on the org's billing page.
  const todayUtcMs = before.getTime() - 86_400_000;
  const where = { repo: { orgId } };
  // The billable/free split and provider mix are shown beside the "Last Nd" window, so they
  // must be scoped to the same window as periodScans — otherwise the billable figure reported
  // for a selected period would actually be the org's all-time private-scan total.
  const periodWhere = { ...where, scannedAt: { gte: since, lt: before } };

  const [total, period, billable, distinctRepos, providerGroups, agg, daily, scanGroups] =
    await Promise.all([
      prisma.scan.count({ where }),
      prisma.scan.count({ where: periodWhere }),
      // Headline billable tile: the SAME predicate the chart's `billable` series uses (isBillableScan),
      // over the same window — so the tile can't drift from the chart total. `publicScans` (free) is
      // then derived as period - billable rather than separately queried.
      prisma.scan.count({ where: { ...periodWhere, ...billableScanWhere(orgId) } }),
      prisma.repository.count({ where: { orgId, scans: { some: {} } } }),
      prisma.scan.groupBy({ by: ["engineProvider"], where: periodWhere, _count: true }),
      prisma.scan.aggregate({ where, _min: { scannedAt: true }, _max: { scannedAt: true } }),
      // Per-day series, aggregated in SQL (one row per UTC-day × billable) instead of streaming
      // every period scan row back to bucket in JS — see fetchDailySeries.
      fetchDailySeries(prisma, orgId, since, before, periodDays, todayUtcMs),
      // ONE groupBy, folded THREE ways. This window used to be grouped three times over the same
      // `periodWhere` — (provider, model, byom) for the cost basis, (repoId) for the top-repos
      // attribution, and (repoId, provider, model, byom) for the team split — and the third was a
      // superset of the other two. The finest key is the only one that has to be asked for; the
      // coarser folds are reductions of it in JS, which is free beside a round trip.
      //
      // The split by (provider, model) matters because failover legitimately mixes models in one
      // window (Gemini Flash cents/MTok beside Claude Sonnet dollars/MTok); a single global rate
      // can't price that. `engineByom` rides in the key so the BYOM half is split OUT of the priced
      // fold without another query: the org's own-account tokens stay counted and shown, and are
      // never invoiced (see estimateLlmCostFromTable). `_count` rides along for `unpricedCalls`: the
      // cost fold refuses to price an unknown model, and a null cost needs a call count beside it.
      //
      // The byRepo fold is scoped by the BILLABLE predicate, as `billableScanWhere` scoped it in SQL
      // — `isBillableScan` applied to the group key plus the repo's `isPrivate` from the one
      // Repository read below, so the "by metered scans" attribution still can't mix free scans into
      // "which repos drove the bill".
      prisma.scan.groupBy({
        by: ["repoId", "engineProvider", "engineModel", "engineByom"],
        where: periodWhere,
        _count: true,
        _sum: { inputTokens: true, outputTokens: true },
      }),
    ]);

  // Fold 1 of 3: (provider, model, byom) — the cost basis. Repo-keyed duplicates of the same model
  // simply sum through every reducer below, so no regrouping is needed to price the period.
  const modelUsage: ModelTokenUsage[] = scanGroups.map((g) => ({
    model: g.engineModel,
    provider: g.engineProvider,
    byom: g.engineByom ?? null,
    inputTokens: g._sum.inputTokens ?? 0,
    outputTokens: g._sum.outputTokens ?? 0,
  }));
  // The token TILES report the period's WHOLE volume: BYOM tokens were really consumed, and hiding
  // them would understate what this org's scanning costs to run. The COST fold sees only the priced
  // half (estimateLlmCostFromTable skips `byom === true`), and `byomScans` below explains the gap.
  const inputTokens = modelUsage.reduce((a, m) => a + m.inputTokens, 0);
  const outputTokens = modelUsage.reduce((a, m) => a + m.outputTokens, 0);
  const priceable = modelUsage.filter((m) => m.byom !== true);
  const pricedInputTokens = priceable.reduce((a, m) => a + m.inputTokens, 0);
  const pricedOutputTokens = priceable.reduce((a, m) => a + m.outputTokens, 0);
  /** Computed scans in the period that ran in the org's OWN provider account — priced by nobody here. */
  const byomScans = scanGroups.reduce((a, g) => a + (g.engineByom === true ? g._count : 0), 0);
  // Cost basis precedence: env rates (operator override, both set) > built-in per-model table > null.
  // The operator's per-MTok rates price ASCENT's account, so they are applied to the PRICED tokens
  // only. When every token in the period is BYOM there is nothing for those rates to price, and the
  // estimate is null: a `$0.00` there would be the same overstatement-by-implication in reverse.
  const envEstimate =
    inputTokens + outputTokens > 0 && pricedInputTokens + pricedOutputTokens === 0
      ? null
      : estimateLlmCostUsd(
          pricedInputTokens,
          pricedOutputTokens,
          process.env.LLM_INPUT_COST_PER_MTOK,
          process.env.LLM_OUTPUT_COST_PER_MTOK,
        );
  const estimatedCostUsd = envEstimate ?? estimateLlmCostFromTable(modelUsage);
  const costBasis: UsageSummary["costBasis"] =
    envEstimate != null ? "env" : estimatedCostUsd != null ? "builtin" : null;

  // ── The lane + team + repo views (#11) ────────────────────────────────────────────────────────
  // All strictly ADDITIVE reads over the window already computed above. The public funnel is skipped
  // entirely: it has no tenant to show a bill back to and no teams to attribute it to, and its
  // summary is anonymously readable, so an attribution surface there would have no membership
  // behind it. (Its ledger is empty by construction anyway — `recordUsageEvent` never writes for a
  // `kind: "public"` org — so this is a saved round trip, not a hidden figure.)
  const isPublic = slug === PUBLIC_ORG_SLUG;
  // ONE Repository read for the window's repos, where there were two: the top-repos panel resolved
  // names for its top ten and the team split resolved default owners for the same window's repos,
  // over overlapping id sets. `fullName`, `isPrivate` and the owning team are three columns of one
  // row — and `isPrivate` is what lets the billable fold move out of SQL without changing the
  // predicate (see the groupBy comment above).
  const repoIds = [...new Set(scanGroups.map((g) => g.repoId))];
  const [otherLanes, otherTeams, laneTeamCells, eventRepos, repoRows] = await Promise.all([
    isPublic ? Promise.resolve([]) : laneTotals(slug, since, before).catch(() => []),
    isPublic ? Promise.resolve([]) : teamTotals(slug, since, before).catch(() => []),
    // MC-B45: the (lane × team) intersection, over the SAME window and the same ledger the two
    // panels above read. Skipped for the public funnel for the reason the team panel is: an
    // anonymously-readable summary must carry no attribution surface at all.
    isPublic ? Promise.resolve([]) : laneTeamTotals(slug, since, before).catch(() => []),
    // The per-REPO half of the same ledger — one level finer than `teamKey`, and the only level
    // finer this ledger will ever carry (per-person attribution is ruled out by the privacy note in
    // docs/features/billing/usage.md).
    isPublic
      ? Promise.resolve([] as RepoEventUsage[])
      : repoTotals(slug, since, before).catch(() => [] as RepoEventUsage[]),
    repoIds.length
      ? prisma.repository.findMany({
          where: { id: { in: repoIds } },
          select: {
            id: true,
            fullName: true,
            isPrivate: true,
            teams: { where: { isDefaultOwner: true }, select: { slug: true }, take: 1 },
          },
        })
      : Promise.resolve([] as PeriodRepoRow[]),
  ]);
  const repoById = new Map<string, PeriodRepoRow>(repoRows.map((r) => [r.id, r]));

  // The `scan` lane, from the Scan-derived figures already in hand — NOT from a second ledger. Its
  // cost IS the summary's own estimate, so the two can never disagree.
  const scanLane: LaneUsage | null =
    period > 0
      ? {
          lane: "scan",
          calls: period,
          inputTokens,
          outputTokens,
          estimatedCostUsd,
          unpricedCalls: unpricedScanCalls(modelUsageWithCounts(scanGroups)),
        }
      : null;
  const byLane: LaneUsage[] = [...(scanLane ? [scanLane] : []), ...otherLanes];

  // ONE fold of the scan lane's team split, read two ways: as the team panel's rows and as the scan
  // ROW of the showback matrix. Two folds of the same groups would eventually disagree (MC-B45).
  // The zero-fill is clamped at the org's first scan: 360 rows of "0 scans" for days before the org
  // existed are measured-looking absence, and the CSV exported them as data (see clampDailySeries).
  const firstScanAt = agg._min.scannedAt ? agg._min.scannedAt.toISOString() : null;
  const clamped = clampDailySeries(daily, since, firstScanAt);

  // Fold 2 of 3: per REPO, over the BILLABLE groups only — the same scope `billableScanWhere` gave
  // this attribution in SQL, now applied to the group key plus the repo's own `isPrivate`. A repo the
  // Repository read did not return cannot be private (there is no row saying so), so it is excluded
  // exactly as the join would have excluded it.
  const byRepo: RepoUsage[] = mergeRepoUsage(
    scanRepoUsage(
      scanGroups.filter((g) =>
        isBillableScan({
          isPrivate: repoById.get(g.repoId)?.isPrivate ?? false,
          engineProvider: g.engineProvider,
          engineByom: g.engineByom,
        }),
      ),
      repoById,
    ),
    eventRepos.map(eventRepoUsage),
  );

  // Fold 3 of 3: per (repo → owning team), from the same groups and the same Repository read.
  const scanCells = isPublic ? [] : scanTeamUsage(scanGroups, repoById);
  const byTeam: TeamUsage[] = isPublic ? [] : mergeTeamUsage(scanTeamRows(scanCells), otherTeams);
  const byLaneTeam: LaneTeamCell[] = isPublic ? [] : mergeLaneTeamCells([...scanCells, ...laneTeamCells]);

  return {
    org: slug,
    unmeteredFunnel,
    periodDays,
    totalScans: total,
    periodScans: period,
    privateScans: billable,
    // Free = the period's non-billable remainder (public scans + private mock/BYOM scans). Derived so
    // billable + free === periodScans and the tiles match the chart's stacked totals exactly.
    publicScans: Math.max(0, period - billable),
    distinctRepos,
    byProvider: providerGroups
      .map((g) => ({ provider: g.engineProvider, count: g._count }))
      .sort((a, b) => b.count - a.count),
    daily: clamped.daily,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    costBasis,
    byRepo,
    byLane,
    byTeam,
    byLaneTeam,
    ...foldLaneCost(byLane),
    byomScans,
    firstScanAt,
    lastScanAt: agg._max.scannedAt ? agg._max.scannedAt.toISOString() : null,
    windowSince: since.toISOString(),
    windowBefore: before.toISOString(),
    effectiveSince: clamped.effectiveSince,
    effectiveDays: clamped.daily.length,
    timezone: "UTC",
  };
}

/**
 * Estimate LLM cost in USD from token totals + the configured per-MTok rates. Returns null unless
 * BOTH rates are explicitly set: an unset rate means "no estimate" (show "rate not set"), NEVER a
 * silent $0 — otherwise a partial config (only the input rate set) would bill the output side at $0
 * behind a confident dollar figure (a quiet ~halving of the bill). A deliberately-set "0" is a valid
 * explicit price, so both rates "0" yields a real $0.00.
 */
export function estimateLlmCostUsd(
  inputTokens: number,
  outputTokens: number,
  inRateRaw: string | undefined,
  outRateRaw: string | undefined,
): number | null {
  const parseRate = (raw: string | undefined): number | null => {
    if (raw == null || raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const inRate = parseRate(inRateRaw);
  const outRate = parseRate(outRateRaw);
  if (inRate == null || outRate == null) return null;
  return (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;
}

/** One (provider, model) pair's token totals within the period — the input to the per-model cost fold. */
export interface ModelTokenUsage {
  model: string | null;
  /** Persisted `Scan.engineProvider`. Optional so older callers/mocks still typecheck, but supplying
   *  it is what lets the fold recognize a $0 provider — see {@link estimateLlmCostFromTable}. */
  provider?: string | null;
  /** Persisted `Scan.engineByom`. `true` means the scan ran in the ORG'S OWN provider account: the
   *  org already paid its vendor for those tokens and Ascent has no figure for them. Nullable/absent
   *  (rows predating the column, older mocks) means the platform account, so it stays priceable —
   *  the same `!== true` rule {@link isBillableScan} and the meter's `byom === true` guard apply. */
  byom?: boolean | null;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Fold per-model token usage into a USD estimate using the built-in MODEL_PRICES table (the
 * out-of-the-box default basis; env rates override upstream). Pure and unit-tested. Returns null
 * when ANY token-bearing model lacks a table price — a partial figure that silently omits the
 * unpriceable tokens would be the same half-billing trap estimateLlmCostUsd refuses — and null
 * when no tokens were consumed at all (mock-only periods show "no estimate", not $0.00 "spend").
 */
export function estimateLlmCostFromTable(usage: ModelTokenUsage[]): number | null {
  let cost = 0;
  let pricedAny = false;
  for (const m of usage) {
    // BYOM: the org bought these tokens from its OWN vendor on its own account, so Ascent has no
    // figure for them and must not invent one. `pricedAny` is deliberately NOT set — a period whose
    // only tokens are BYOM prices as null ("no estimate"), never as a $0 that reads like a free
    // month. This is the rule `meter()` already applies to every other lane (`if (byom === true)
    // return null`, src/lib/llm/meter.ts) and the one docs/features/billing/usage.md states for all
    // of them; the scan lane was the single exception, and it was the one figure on this page that
    // could OVERSTATE money. The volume is not lost: those calls land in `unpricedScanCalls`.
    if (m.byom === true) continue;
    if (m.inputTokens + m.outputTokens === 0) continue; // token-less rows (mock) price as nothing
    // Local inference bills nothing per token: it ran on the operator's own GPU. Priced at exactly
    // zero rather than skipped, so a self-hosted org whose ONLY engine is local reads "$0.00" instead
    // of "no estimate" — and, more importantly, so a local model tag that happens to prefix-match a
    // hosted one in MODEL_PRICES can't invoice it at that vendor's rate. `pricedAny` is set because
    // the row IS priced; zero is the price. (See isZeroCostProvider in src/lib/llm/config.ts.)
    if (isZeroCostProvider(m.provider)) {
      pricedAny = true;
      continue;
    }
    const price = priceForModel(m.model);
    if (!price) return null;
    cost += (m.inputTokens / 1_000_000) * price.inPerMTok + (m.outputTokens / 1_000_000) * price.outPerMTok;
    pricedAny = true;
  }
  return pricedAny ? cost : null;
}

// ── The lane + team folds (#11) ──────────────────────────────────────────────────────────────────

/** A (provider, model) group with the call count the lane view needs beside its tokens. */
type ModelCallGroup = ModelTokenUsage & { calls: number };

/**
 * One row of THE per-(repo, provider, model, byom) groupBy — the single pass this module makes over
 * the period, folded three ways (cost basis, per repo, per owning team). It was three passes over
 * one `where`, the finest of which was a superset of the other two.
 */
export interface PeriodScanGroup {
  repoId: string;
  engineProvider: string;
  engineModel: string | null;
  engineByom?: boolean | null;
  _count: number;
  _sum: { inputTokens: number | null; outputTokens: number | null };
}

/** The Repository columns those folds need, resolved in ONE read for the window's repos: the name
 *  the repo panel prints, the `isPrivate` the billable filter needs, the CODEOWNERS default owner. */
export interface PeriodRepoRow {
  id: string;
  fullName: string;
  isPrivate: boolean;
  teams: { slug: string }[];
}

/** One group as the cost fold's input — the ONE shaping, so every fold prices identically. */
function modelCallGroup(g: PeriodScanGroup): ModelCallGroup {
  return {
    model: g.engineModel,
    provider: g.engineProvider,
    byom: g.engineByom ?? null,
    calls: g._count,
    inputTokens: g._sum.inputTokens ?? 0,
    outputTokens: g._sum.outputTokens ?? 0,
  };
}

/** Shape the per-model groupBy into the fold's input, once, so the two consumers agree. */
function modelUsageWithCounts(groups: PeriodScanGroup[]): ModelCallGroup[] {
  return groups.map(modelCallGroup);
}

/**
 * The scan lane's per-REPO split, from the same groups the team split folds — the money half of the
 * "Top repositories" attribution, which counted scans and tokens and never dollars.
 *
 * Priced by the SAME fold as every other figure on the page (`estimateLlmCostFromTable`), so a BYOM
 * repo prices as null rather than as a $0 that reads like a free month (32015371), and a repo whose
 * model has no rate reports its unpriced calls instead of a confident short figure.
 */
export function scanRepoUsage(
  groups: PeriodScanGroup[],
  repoById: ReadonlyMap<string, PeriodRepoRow>,
): RepoUsage[] {
  const acc = new Map<string, ModelCallGroup[]>();
  for (const g of groups) {
    // The repo's name, or its id when the row is somehow absent — an unnamed repo is still spend.
    const key = repoById.get(g.repoId)?.fullName ?? g.repoId;
    acc.set(key, [...(acc.get(key) ?? []), modelCallGroup(g)]);
  }
  return [...acc.entries()].map(([fullName, models]) => {
    const calls = models.reduce((n, m) => n + m.calls, 0);
    return {
      fullName,
      label: fullName,
      scans: calls,
      tokens: models.reduce((n, m) => n + m.inputTokens + m.outputTokens, 0),
      calls,
      estimatedCostUsd: estimateLlmCostFromTable(models),
      unpricedCalls: unpricedScanCalls(models),
    };
  });
}

/** A ledger repo row as the merge's second side: calls and cost, no scans — those are the scan
 *  lane's own unit, and a repo can carry companion/agent spend without a billable scan behind it. */
export function eventRepoUsage(row: RepoEventUsage): RepoUsage {
  return {
    fullName: row.repoFullName,
    label: row.repoFullName ?? ORG_WIDE_TEAM_LABEL,
    scans: 0,
    tokens: 0,
    calls: row.calls,
    estimatedCostUsd: row.estimatedCostUsd,
    unpricedCalls: row.unpricedCalls,
  };
}

/**
 * Union the scan lane's per-repo split with the ledger's, on the repo's full name — the same merge
 * `mergeTeamUsage` makes one level coarser, under the SAME cost rule: a side that HAS calls and no
 * cost is unknown, and unknown + known is still unknown. Adding only the priced half would print a
 * confident figure that omits real spend.
 *
 * Ordering: biggest metered-scan volume first (what the panel sorted on before this had costs at
 * all), then calls, then the name so a tie is stable. The repo-less bucket is not a repo and does not
 * compete for a place in the top N — it is appended, always last, so work with no repository is
 * visible without displacing the attribution the panel is for.
 */
export function mergeRepoUsage(a: RepoUsage[], b: RepoUsage[], limit = 10): RepoUsage[] {
  const out = new Map<string | null, RepoUsage>();
  for (const row of [...a, ...b]) {
    const prev = out.get(row.fullName);
    if (!prev) {
      out.set(row.fullName, { ...row });
      continue;
    }
    const unknown =
      (prev.estimatedCostUsd == null && prev.calls > 0) || (row.estimatedCostUsd == null && row.calls > 0);
    out.set(row.fullName, {
      fullName: row.fullName,
      label: prev.label,
      scans: prev.scans + row.scans,
      tokens: prev.tokens + row.tokens,
      calls: prev.calls + row.calls,
      estimatedCostUsd: unknown ? null : (prev.estimatedCostUsd ?? 0) + (row.estimatedCostUsd ?? 0),
      unpricedCalls: prev.unpricedCalls + row.unpricedCalls,
    });
  }
  const rows = [...out.values()];
  const named = rows
    .filter((r) => r.fullName != null)
    .sort((x, y) => y.scans - x.scans || y.calls - x.calls || x.label.localeCompare(y.label))
    .slice(0, Math.max(1, limit));
  const orgWide = rows.find((r) => r.fullName == null);
  return orgWide ? [...named, orgWide] : named;
}

/**
 * How many of the period's scans could NOT be costed — the number that makes a null (or a $0)
 * estimate readable. Three causes, all counted: a BYOM run (the org paid its own vendor; Ascent has
 * no figure), a token-less run (mock / degraded — no basis exists) and a token-bearing run on a
 * model `MODEL_PRICES` does not know (the table refuses to guess a rate).
 * A zero-cost provider is NOT counted: local inference has a real price and it is zero.
 */
export function unpricedScanCalls(usage: ModelCallGroup[]): number {
  let unpriced = 0;
  for (const m of usage) {
    // Unpriceable BY POLICY rather than for want of a rate, and checked FIRST: a BYOM run served by
    // a zero-cost local provider is still the org's own spend, not Ascent's priced $0.
    if (m.byom === true) {
      unpriced += m.calls;
      continue;
    }
    if (isZeroCostProvider(m.provider)) continue;
    if (m.inputTokens + m.outputTokens === 0 || !priceForModel(m.model)) unpriced += m.calls;
  }
  return unpriced;
}

/**
 * The scan lane's per-team split: `Scan → Repository → RepoTeam(isDefaultOwner)`.
 *
 * The join is performed in JS, over the ONE Repository read the whole summary shares (this function
 * used to issue a second `findMany` of its own for the same window's repos), and it is a LEFT join:
 * a repo with no CODEOWNERS default
 * owner falls into the explicit `null` (org-wide) bucket rather than dropping out of the report. An
 * inner join would silently shrink the org's total spend by however much untagged work it does, which
 * is exactly the number an operator would then reconcile against and fail to explain.
 *
 * Returns the scan lane's row OF THE SHOWBACK MATRIX (`LaneTeamCell[]`, one per team) rather than a
 * bare `TeamUsage[]`: the team panel and the matrix's scan row are the same split of the same groups,
 * and computing them twice — from two queries and two folds — is how they would come to disagree
 * (MC-B45). `scanTeamRows` projects the panel's shape back out of these cells.
 */
function scanTeamUsage(groups: PeriodScanGroup[], repoById: ReadonlyMap<string, PeriodRepoRow>): LaneTeamCell[] {
  if (groups.length === 0) return [];
  const acc = new Map<string | null, ModelCallGroup[]>();
  for (const g of groups) {
    // `?? null` and not `undefined`: a repo the lookup did not return is org-wide, not missing.
    const key = repoById.get(g.repoId)?.teams[0]?.slug ?? null;
    acc.set(key, [...(acc.get(key) ?? []), modelCallGroup(g)]);
  }
  return [...acc.entries()].map(([teamKey, models]) => ({
    lane: "scan" as const,
    teamKey,
    calls: models.reduce((n, m) => n + m.calls, 0),
    // Same fold, same refusal-to-guess as the headline estimate.
    estimatedCostUsd: estimateLlmCostFromTable(models),
    // The per-team share of the same count the `scan` LANE row reports — folded by the one definition
    // of "could not be costed" rather than by a second, drifting one.
    unpricedCalls: unpricedScanCalls(models),
  }));
}

/** The `Spend by team` panel's shape, projected from the scan lane's matrix cells so the panel and
 *  the matrix can never split. `unpricedCalls` is dropped: that panel does not report it. */
export function scanTeamRows(cells: readonly LaneTeamCell[]): TeamUsage[] {
  return cells.map((c) => ({
    teamKey: c.teamKey,
    label: c.teamKey ?? ORG_WIDE_TEAM_LABEL,
    calls: c.calls,
    estimatedCostUsd: c.estimatedCostUsd,
  }));
}

/**
 * Union the scan lane's team split with the other lanes' (`UsageEvent.teamKey`), on the team key.
 *
 * Cost merges under the rule the rest of this module uses: a side that HAS calls but no cost is
 * unknown, and unknown + known is still unknown. Adding only the half we can price would print a
 * confident figure that omits real spend — the same half-billing trap `estimateLlmCostUsd` refuses.
 */
export function mergeTeamUsage(a: TeamUsage[], b: TeamUsage[]): TeamUsage[] {
  const out = new Map<string | null, TeamUsage>();
  for (const row of [...a, ...b]) {
    const prev = out.get(row.teamKey);
    if (!prev) {
      out.set(row.teamKey, { ...row });
      continue;
    }
    const unknown =
      (prev.estimatedCostUsd == null && prev.calls > 0) || (row.estimatedCostUsd == null && row.calls > 0);
    out.set(row.teamKey, {
      teamKey: row.teamKey,
      label: prev.label,
      calls: prev.calls + row.calls,
      estimatedCostUsd: unknown ? null : (prev.estimatedCostUsd ?? 0) + (row.estimatedCostUsd ?? 0),
    });
  }
  // Biggest spender first, with the unknown-cost buckets after the priced ones and the org-wide
  // bucket last on a tie — a panel reads top-down and the question is "who drives the bill".
  return [...out.values()].sort(
    (x, y) => (y.estimatedCostUsd ?? -1) - (x.estimatedCostUsd ?? -1) || y.calls - x.calls,
  );
}

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/** Floor an epoch-ms instant to the start of its UTC day. Epoch 0 is a UTC midnight and a day is
 *  exactly 86_400_000 ms in JS time (no leap seconds), so a multiple of that is UTC midnight. */
function utcDayStart(ms: number): number {
  return Math.floor(ms / 86_400_000) * 86_400_000;
}

/**
 * Aggregate the period's computed scans into a per-UTC-day billable/free series in SQL — a single
 * COUNT(*) per (day, billable) row (~periodDays×2 rows) rather than streaming every scan row in
 * the window back to bucket in JS (thousands of rows on a busy org). `date_trunc` is standard SQL
 * supported by both local Postgres and Aurora DSQL, and Prisma stores DateTime as UTC `timestamp`,
 * so `date_trunc('day', "scannedAt")` is the UTC day that matches the dayKey axis; `to_char` formats
 * it to the same YYYY-MM-DD token (no driver-dependent Date round-trip) and `::int` keeps COUNT out
 * of BigInt. Falls back to row-bucketing if the raw query is ever unavailable, so /usage can't break.
 *
 * The `billable` expression is the SQL transcription of {@link isBillableScan} (the JS fallback below
 * calls that function directly, so the two paths cannot classify a scan differently): private AND not
 * the keyless `mock` provider AND not BYOM. `IS NOT TRUE` — not `<> true` — so a NULL `engineByom`
 * (rows predating the column) stays billable exactly as `engineByom !== true` does in JS. Both the
 * lower AND upper `scannedAt` bounds are passed in from the caller, shared with the headline counts.
 */
async function fetchDailySeries(
  prisma: ReturnType<typeof getPrisma>,
  orgId: string,
  since: Date,
  before: Date,
  periodDays: number,
  anchorUtcMs: number,
): Promise<UsageDay[]> {
  const series = emptyDailySeries(periodDays, anchorUtcMs);
  const idx = new Map(series.map((d, i) => [d.date, i]));
  try {
    const rows = await prisma.$queryRaw<{ day: string; billable: boolean; count: number }[]>`
      SELECT to_char(date_trunc('day', s."scannedAt"), 'YYYY-MM-DD') AS day,
             (r."isPrivate"
               AND s."engineProvider" <> ${UNMETERED_PROVIDER}
               AND s."engineByom" IS NOT TRUE) AS billable,
             COUNT(*)::int AS count
      FROM "Scan" s
      JOIN "Repository" r ON r."id" = s."repoId"
      WHERE r."orgId" = ${orgId} AND s."scannedAt" >= ${since} AND s."scannedAt" < ${before}
      GROUP BY day, billable
    `;
    for (const row of rows) {
      const i = idx.get(row.day);
      if (i === undefined) continue;
      const day = series[i]!; // safe: i is a valid index into series (built from series.map)
      if (row.billable) day.billable += Number(row.count);
      else day.free += Number(row.count);
    }
    return series;
  } catch (err) {
    console.error("[usage] daily aggregation query failed, falling back to row bucketing", err);
    const scans = await prisma.scan.findMany({
      where: { repo: { orgId }, scannedAt: { gte: since, lt: before } },
      select: {
        scannedAt: true,
        engineProvider: true,
        engineByom: true,
        repo: { select: { isPrivate: true } },
      },
    });
    return buildDailySeries(
      periodDays,
      anchorUtcMs,
      scans.map((s) => ({
        at: s.scannedAt,
        billable: isBillableScan({
          isPrivate: s.repo.isPrivate,
          engineProvider: s.engineProvider,
          engineByom: s.engineByom,
        }),
      })),
    );
  }
}

/** A zero-filled day series for the last `periodDays` UTC days ending at `anchorUtcMs`'s day, so the
 *  chart has a stable x-axis whose keys exactly match the UTC dayKey of any bucketed scan. */
function emptyDailySeries(periodDays: number, anchorUtcMs: number = utcDayStart(Date.now())): UsageDay[] {
  const days: UsageDay[] = [];
  const todayUtc = utcDayStart(anchorUtcMs);
  for (let i = periodDays - 1; i >= 0; i--) {
    days.push({ date: dayKey(new Date(todayUtc - i * 86_400_000)), billable: 0, free: 0 });
  }
  return days;
}

/** Bucket scans into the zero-filled day series by UTC date (the JS fallback for fetchDailySeries). */
export function buildDailySeries(
  periodDays: number,
  anchorUtcMs: number,
  scans: { at: Date; billable: boolean }[],
): UsageDay[] {
  const series = emptyDailySeries(periodDays, anchorUtcMs);
  const idx = new Map(series.map((d, i) => [d.date, i]));
  for (const s of scans) {
    const i = idx.get(dayKey(s.at));
    if (i === undefined) continue;
    const day = series[i]!; // safe: i is a valid index into series (built from series.map)
    if (s.billable) day.billable += 1;
    else day.free += 1;
  }
  return series;
}
