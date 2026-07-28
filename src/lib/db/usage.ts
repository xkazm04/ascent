// Usage metering. Pricing is usage-based (per private scan), and each *computed* scan
// persists exactly one Scan row (cache hits don't persist), so Scan rows are the
// authoritative metered unit. This module aggregates them into a billing/usage summary
// per organization and period. (Per-org attribution becomes meaningful once auth / the
// GitHub App lands; until then everything is under the "public" org.)

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { priceForModel } from "@/lib/llm/config";

export interface ProviderUsage {
  provider: string;
  count: number;
}

/** Per-repo METERED (private/billable) usage within the period — which repos drove the bill. */
export interface RepoUsage {
  fullName: string;
  scans: number;
  tokens: number; // input + output
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
  /** Top repos by METERED (private) scan volume within the period (with their token spend).
   *  Scoped private-only to match the "metered/billable" framing — free public scans are
   *  excluded, so the attribution answers "which repos drove the bill", not raw volume. */
  byRepo: RepoUsage[];
  firstScanAt: string | null;
  lastScanAt: string | null;
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

export async function getUsageSummary(
  orgSlug = "public",
  periodDays = 30,
): Promise<UsageSummary | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  // Canonicalize the slug ONCE up front. Org slugs are canonically lowercase (authz + setOrgPlan /
  // credits.ts / the cap-panel logic on /usage all normalize), but this lookup used the raw `?org=`
  // value — so `/usage?org=Public` was treated as the public org by the page yet missed the `public`
  // row here and rendered an empty "no scans metered yet" summary despite real data. Normalize so the
  // DB lookup agrees with every downstream check; /api/usage shares this path, so it's fixed too.
  const slug = orgSlug.trim().toLowerCase();

  const empty: UsageSummary = {
    org: slug,
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
    firstScanAt: null,
    lastScanAt: null,
  };

  const orgId = await getOrgId(orgSlug);
  if (!orgId) return empty;

  // Anchor the window to UTC calendar days. `since` is the START of the oldest day shown on the
  // chart, derived from the SAME UTC-day floor the axis uses (emptyDailySeries) — so every counted
  // scan's UTC date is guaranteed to land on a generated axis day. The previous code stepped the
  // axis from a LOCAL `new Date()` while keying buckets by UTC date, so near-midnight-UTC scans
  // fell into the idx-miss gap and were silently dropped (under-reporting billable volume).
  const todayUtcMs = utcDayStart(Date.now());
  const since = new Date(todayUtcMs - (periodDays - 1) * 86_400_000);
  // UPPER bound: the exclusive end of TODAY's UTC day — the same edge the generated day axis stops at.
  // Without it the period counts were open-ended while the series index only spans since→today, so a
  // future-dated / clock-skewed scan was counted in the headline Stat tile yet silently idx-missed out
  // of the chart and CSV (`idx.get(row.day)` undefined → row dropped) — the headline and the trend
  // total disagreeing on the org's billing page. Both sides now share this window.
  const before = new Date(todayUtcMs + 86_400_000);
  const where = { repo: { orgId } };
  // The billable/free split and provider mix are shown beside the "Last Nd" window, so they
  // must be scoped to the same window as periodScans — otherwise the billable figure reported
  // for a selected period would actually be the org's all-time private-scan total.
  const periodWhere = { ...where, scannedAt: { gte: since, lt: before } };

  const [total, period, billable, distinctRepos, providerGroups, agg, daily, modelGroups, repoGroups] =
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
      // Token totals (cost basis) grouped PER MODEL — one aggregate, no row streaming. The split
      // matters because failover legitimately mixes models in one window (Gemini Flash cents/MTok
      // beside Claude Sonnet dollars/MTok); a single global rate can't price that correctly. byRepo
      // is scoped by billableScanWhere (the same predicate as the headline count above) so the "by
      // metered scans" attribution can't mix free scans into "which repos drove the bill".
      prisma.scan.groupBy({
        by: ["engineModel"],
        where: periodWhere,
        _sum: { inputTokens: true, outputTokens: true },
      }),
      prisma.scan.groupBy({
        by: ["repoId"],
        where: { ...periodWhere, ...billableScanWhere(orgId) },
        _count: true,
        _sum: { inputTokens: true, outputTokens: true },
        orderBy: { _count: { repoId: "desc" } },
        take: 10,
      }),
    ]);

  const modelUsage: ModelTokenUsage[] = modelGroups.map((g) => ({
    model: g.engineModel,
    inputTokens: g._sum.inputTokens ?? 0,
    outputTokens: g._sum.outputTokens ?? 0,
  }));
  const inputTokens = modelUsage.reduce((a, m) => a + m.inputTokens, 0);
  const outputTokens = modelUsage.reduce((a, m) => a + m.outputTokens, 0);
  // Cost basis precedence: env rates (operator override, both set) > built-in per-model table > null.
  const envEstimate = estimateLlmCostUsd(
    inputTokens,
    outputTokens,
    process.env.LLM_INPUT_COST_PER_MTOK,
    process.env.LLM_OUTPUT_COST_PER_MTOK,
  );
  const estimatedCostUsd = envEstimate ?? estimateLlmCostFromTable(modelUsage);
  const costBasis: UsageSummary["costBasis"] =
    envEstimate != null ? "env" : estimatedCostUsd != null ? "builtin" : null;

  // Resolve the top repoIds → fullName (a small IN query, capped at the top 10).
  const repoIds = repoGroups.map((g) => g.repoId);
  const nameById = new Map(
    repoIds.length
      ? (
          await prisma.repository.findMany({
            where: { id: { in: repoIds } },
            select: { id: true, fullName: true },
          })
        ).map((r) => [r.id, r.fullName])
      : [],
  );
  const byRepo: RepoUsage[] = repoGroups.map((g) => ({
    fullName: nameById.get(g.repoId) ?? g.repoId,
    scans: g._count,
    tokens: (g._sum.inputTokens ?? 0) + (g._sum.outputTokens ?? 0),
  }));

  return {
    org: slug,
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
    daily,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    costBasis,
    byRepo,
    firstScanAt: agg._min.scannedAt ? agg._min.scannedAt.toISOString() : null,
    lastScanAt: agg._max.scannedAt ? agg._max.scannedAt.toISOString() : null,
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

/** One model's token totals within the period — the input to the per-model cost fold. */
export interface ModelTokenUsage {
  model: string | null;
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
    if (m.inputTokens + m.outputTokens === 0) continue; // token-less rows (mock) price as nothing
    const price = priceForModel(m.model);
    if (!price) return null;
    cost += (m.inputTokens / 1_000_000) * price.inPerMTok + (m.outputTokens / 1_000_000) * price.outPerMTok;
    pricedAny = true;
  }
  return pricedAny ? cost : null;
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
