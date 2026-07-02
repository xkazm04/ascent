// Usage metering. Pricing is usage-based (per private scan), and each *computed* scan
// persists exactly one Scan row (cache hits don't persist), so Scan rows are the
// authoritative metered unit. This module aggregates them into a billing/usage summary
// per organization and period. (Per-org attribution becomes meaningful once auth / the
// GitHub App lands; until then everything is under the "public" org.)

import { getPrisma, isDbConfigured } from "@/lib/db/client";
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

/** One day's computed-scan counts, split billable (private) vs free (public). */
export interface UsageDay {
  date: string; // YYYY-MM-DD (UTC)
  billable: number;
  free: number;
}

export interface UsageSummary {
  org: string;
  periodDays: number;
  /** All-time computed-scan count for the org. */
  totalScans: number;
  /** Computed scans within the last `periodDays`. */
  periodScans: number;
  /** Billable (private) computed scans within the last `periodDays`. */
  privateScans: number;
  /** Free (public) computed scans within the last `periodDays`. */
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

export async function getUsageSummary(
  orgSlug = "public",
  periodDays = 30,
): Promise<UsageSummary | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  // Org slugs are canonically lowercase (authz + setOrgPlan/credits.ts normalize). `/usage` and
  // `/api/usage` pass the raw `?org=` through, so a mixed-case slug (`?org=Facebook`) found no org and
  // returned the all-zero `empty` summary even for a real org with scans — inconsistent with the credit
  // panel on the same page, which DOES lowercase. Canonicalize here too, and echo the canonical slug.
  const slug = orgSlug.toLowerCase();

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

  const org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) return empty;

  // Anchor the window to UTC calendar days. `since` is the START of the oldest day shown on the
  // chart, derived from the SAME UTC-day floor the axis uses (emptyDailySeries) — so every counted
  // scan's UTC date is guaranteed to land on a generated axis day. The previous code stepped the
  // axis from a LOCAL `new Date()` while keying buckets by UTC date, so near-midnight-UTC scans
  // fell into the idx-miss gap and were silently dropped (under-reporting billable volume).
  const todayUtcMs = utcDayStart(Date.now());
  const since = new Date(todayUtcMs - (periodDays - 1) * 86_400_000);
  const where = { repo: { orgId: org.id } };
  // The private/public split and provider mix are shown beside the "Last Nd" window, so they
  // must be scoped to the same window as periodScans — otherwise the billable figure reported
  // for a selected period would actually be the org's all-time private-scan total.
  const periodWhere = { ...where, scannedAt: { gte: since } };

  const [total, period, priv, pub, distinctRepos, providerGroups, agg, daily, modelGroups, repoGroups] =
    await Promise.all([
      prisma.scan.count({ where }),
      prisma.scan.count({ where: periodWhere }),
      prisma.scan.count({ where: { ...periodWhere, repo: { orgId: org.id, isPrivate: true } } }),
      prisma.scan.count({ where: { ...periodWhere, repo: { orgId: org.id, isPrivate: false } } }),
      prisma.repository.count({ where: { orgId: org.id, scans: { some: {} } } }),
      prisma.scan.groupBy({ by: ["engineProvider"], where: periodWhere, _count: true }),
      prisma.scan.aggregate({ where, _min: { scannedAt: true }, _max: { scannedAt: true } }),
      // Per-day series, aggregated in SQL (one row per UTC-day × visibility) instead of streaming
      // every period scan row back to bucket in JS — see fetchDailySeries.
      fetchDailySeries(prisma, org.id, since, periodDays, todayUtcMs),
      // Token totals (cost basis) grouped PER MODEL — one aggregate, no row streaming. The split
      // matters because failover legitimately mixes models in one window (Gemini Flash cents/MTok
      // beside Claude Sonnet dollars/MTok); a single global rate can't price that correctly. byRepo
      // is scoped to PRIVATE repos (the same predicate as the `priv` count above) so the "by
      // metered scans" attribution can't mix free public scans into "which repos drove the bill".
      prisma.scan.groupBy({
        by: ["engineModel"],
        where: periodWhere,
        _sum: { inputTokens: true, outputTokens: true },
      }),
      prisma.scan.groupBy({
        by: ["repoId"],
        where: { ...periodWhere, repo: { orgId: org.id, isPrivate: true } },
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
    privateScans: priv,
    publicScans: pub,
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
 * COUNT(*) per (day, visibility) row (~periodDays×2 rows) rather than streaming every scan row in
 * the window back to bucket in JS (thousands of rows on a busy org). `date_trunc` is standard SQL
 * supported by both local Postgres and Aurora DSQL, and Prisma stores DateTime as UTC `timestamp`,
 * so `date_trunc('day', "scannedAt")` is the UTC day that matches the dayKey axis; `to_char` formats
 * it to the same YYYY-MM-DD token (no driver-dependent Date round-trip) and `::int` keeps COUNT out
 * of BigInt. Falls back to row-bucketing if the raw query is ever unavailable, so /usage can't break.
 */
async function fetchDailySeries(
  prisma: ReturnType<typeof getPrisma>,
  orgId: string,
  since: Date,
  periodDays: number,
  anchorUtcMs: number,
): Promise<UsageDay[]> {
  const series = emptyDailySeries(periodDays, anchorUtcMs);
  const idx = new Map(series.map((d, i) => [d.date, i]));
  try {
    const rows = await prisma.$queryRaw<{ day: string; isPrivate: boolean; count: number }[]>`
      SELECT to_char(date_trunc('day', s."scannedAt"), 'YYYY-MM-DD') AS day,
             r."isPrivate" AS "isPrivate",
             COUNT(*)::int AS count
      FROM "Scan" s
      JOIN "Repository" r ON r."id" = s."repoId"
      WHERE r."orgId" = ${orgId} AND s."scannedAt" >= ${since}
      GROUP BY day, r."isPrivate"
    `;
    for (const row of rows) {
      const i = idx.get(row.day);
      if (i === undefined) continue;
      const day = series[i]!; // safe: i is a valid index into series (built from series.map)
      if (row.isPrivate) day.billable += Number(row.count);
      else day.free += Number(row.count);
    }
    return series;
  } catch (err) {
    console.error("[usage] daily aggregation query failed, falling back to row bucketing", err);
    const scans = await prisma.scan.findMany({
      where: { repo: { orgId }, scannedAt: { gte: since } },
      select: { scannedAt: true, repo: { select: { isPrivate: true } } },
    });
    return buildDailySeries(
      periodDays,
      anchorUtcMs,
      scans.map((s) => ({ at: s.scannedAt, billable: s.repo.isPrivate })),
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
