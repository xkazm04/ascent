// Usage metering. Pricing is usage-based (per private scan), and each *computed* scan
// persists exactly one Scan row (cache hits don't persist), so Scan rows are the
// authoritative metered unit. This module aggregates them into a billing/usage summary
// per organization and period. (Per-org attribution becomes meaningful once auth / the
// GitHub App lands; until then everything is under the "public" org.)

import { getPrisma, isDbConfigured } from "@/lib/db/client";

export interface ProviderUsage {
  provider: string;
  count: number;
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
  firstScanAt: string | null;
  lastScanAt: string | null;
}

export async function getUsageSummary(
  orgSlug = "public",
  periodDays = 30,
): Promise<UsageSummary | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();

  const empty: UsageSummary = {
    org: orgSlug,
    periodDays,
    totalScans: 0,
    periodScans: 0,
    privateScans: 0,
    publicScans: 0,
    distinctRepos: 0,
    byProvider: [],
    daily: emptyDailySeries(periodDays),
    firstScanAt: null,
    lastScanAt: null,
  };

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return empty;

  const since = new Date(Date.now() - periodDays * 86_400_000);
  const where = { repo: { orgId: org.id } };
  // The private/public split and provider mix are shown beside the "Last Nd" window, so they
  // must be scoped to the same window as periodScans — otherwise the billable figure reported
  // for a selected period would actually be the org's all-time private-scan total.
  const periodWhere = { ...where, scannedAt: { gte: since } };

  const [total, period, priv, pub, distinctRepos, providerGroups, agg, periodScanRows] = await Promise.all([
    prisma.scan.count({ where }),
    prisma.scan.count({ where: periodWhere }),
    prisma.scan.count({ where: { ...periodWhere, repo: { orgId: org.id, isPrivate: true } } }),
    prisma.scan.count({ where: { ...periodWhere, repo: { orgId: org.id, isPrivate: false } } }),
    prisma.repository.count({ where: { orgId: org.id, scans: { some: {} } } }),
    prisma.scan.groupBy({ by: ["engineProvider"], where: periodWhere, _count: true }),
    prisma.scan.aggregate({ where, _min: { scannedAt: true }, _max: { scannedAt: true } }),
    // Per-day series: pull the period's scans with just date + visibility, bucket in JS so the
    // grouping is identical on local Postgres and Aurora DSQL (no DB-specific date_trunc).
    prisma.scan.findMany({
      where: periodWhere,
      select: { scannedAt: true, repo: { select: { isPrivate: true } } },
    }),
  ]);

  return {
    org: orgSlug,
    periodDays,
    totalScans: total,
    periodScans: period,
    privateScans: priv,
    publicScans: pub,
    distinctRepos,
    byProvider: providerGroups
      .map((g) => ({ provider: g.engineProvider, count: g._count }))
      .sort((a, b) => b.count - a.count),
    daily: buildDailySeries(
      periodDays,
      periodScanRows.map((s) => ({ at: s.scannedAt, billable: s.repo.isPrivate })),
    ),
    firstScanAt: agg._min.scannedAt ? agg._min.scannedAt.toISOString() : null,
    lastScanAt: agg._max.scannedAt ? agg._max.scannedAt.toISOString() : null,
  };
}

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/** A zero-filled day series for the last `periodDays` (so the chart has a stable x-axis). */
function emptyDailySeries(periodDays: number): UsageDay[] {
  const days: UsageDay[] = [];
  const today = new Date();
  for (let i = periodDays - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    days.push({ date: dayKey(d), billable: 0, free: 0 });
  }
  return days;
}

/** Bucket scans into the zero-filled day series by UTC date. */
function buildDailySeries(periodDays: number, scans: { at: Date; billable: boolean }[]): UsageDay[] {
  const series = emptyDailySeries(periodDays);
  const idx = new Map(series.map((d, i) => [d.date, i]));
  for (const s of scans) {
    const i = idx.get(dayKey(s.at));
    if (i === undefined) continue;
    if (s.billable) series[i].billable += 1;
    else series[i].free += 1;
  }
  return series;
}
