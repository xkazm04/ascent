// ── DELIVERY OVER TIME (G7-09) ───────────────────────────────────────────────────────────────────
//
// Every other analytics surface on the org dashboard has a trend; Delivery did not. Its three panels
// (`getOrgPrSignals`, `getOrgGovernance`, `getOrgActivity`) all read each repo's LATEST scan, so a
// leader saw today's snapshot with no way to tell whether delivery health was improving or degrading.
// The underlying data was already historical — every `Scan` row persists its own `prStats` and
// `governance` blob — it simply was never read window-wide.
//
// WHAT A POINT MEANS (say it, don't imply it). One point = one CALENDAR DAY in the canonical org zone
// (`@/lib/org/timezone`, half-open days, UTC by default), aggregated over the scans that RAN that day.
// It is therefore a *sample*, not a fleet census: on a day when only one repo was scanned, that day's
// rates describe that one repo. This is the same semantics as the org maturity trend in
// `org-rollup.ts` — and, exactly like it, the honest fix is disclosure, not a fabricated "as of that
// day the whole fleet looked like…" reconstruction (which would need a latest-scan-per-repo-as-of-day
// query per day and would silently carry a stale repo's rates forward for months). Each point
// therefore carries its own `scans` / `repos` / `prs` sample size so the UI can show what is behind it.
//
// WEIGHTING mirrors `getOrgPrSignals` exactly: rates are weighted by each scan's `analyzed` PR count,
// so a 500-PR flagship outweighs a 1-PR toy repo. A nullable rate ("no sample" — `reviewedRate`,
// `aiGovernedRate`) contributes only where present and stays null when no scan that day carried it;
// null is never coerced to a measured 0.
//
// RETENTION: the lower bound is clamped to the plan's retention window, exactly like the maturity
// trend — history depth follows the tier, and this is a READ floor only (nothing is deleted here).

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { dateRange, getOrgBySlug, segmentScope, techGroupScope } from "@/lib/db/org-shared";
import type { OrgWindow } from "@/lib/db/org-rollup";
import { retentionCutoff } from "@/lib/plans";
import { dayKeyInZone, orgTimeZone } from "@/lib/org/timezone";
import { forecastInsufficiency, forecastTrajectory, type Trajectory } from "@/lib/maturity/forecast";
import type { PrStats } from "@/lib/types";

/** The engine name that marks a deterministic, model-free scan (mirrors `chartEngine.MOCK_ENGINE`). */
const MOCK_ENGINE = "mock";

/** One historical scan, reduced to the columns the trend reads. Exported so the pure builder below
 *  can be unit-tested with plain objects — no Prisma, no DB. */
export interface DeliveryScanRow {
  scannedAt: Date;
  engineProvider: string;
  prStats: string | null;
  governance: string | null;
  /** Repo identity — only used to count distinct repos behind a day (sample-size disclosure). */
  repoId: string;
}

/** The rate metrics the trend tracks. All are 0..100 percentages, so they share one y-axis. */
export type DeliveryRateKey = "mergeRate" | "reviewedRate" | "aiInvolvedRate" | "aiGovernedRate" | "protectedRate";

/** Every metric the trend emits — the rates plus the one duration metric (hours, its own axis). */
export type DeliveryMetricKey = DeliveryRateKey | "hoursToMerge";

/** One calendar day of delivery signal, aggregated over the scans that ran that day. */
export interface DeliveryTrendPoint {
  /** `yyyy-mm-dd` in the canonical org zone. */
  date: string;
  /** Scans behind this point (the sample size). */
  scans: number;
  /** Distinct repos behind this point. */
  repos: number;
  /** Analyzed PRs summed across the day's scans — the weight behind the PR rates. */
  prs: number;
  /** Analyzed-PR-weighted merge rate. Null when no scan that day carried PR stats. */
  mergeRate: number | null;
  /** Analyzed-weighted share of merged human PRs with an approving review. Null = no sample. */
  reviewedRate: number | null;
  /** Analyzed-weighted share of PRs with AI involvement. Null = no sample. */
  aiInvolvedRate: number | null;
  /** Analyzed-weighted share of AI PRs that got an approving review. Null = no sample. */
  aiGovernedRate: number | null;
  /** Mean of the day's per-repo median hours-to-merge (a median-of-medians, left unweighted —
   *  identical to `getOrgPrSignals.typicalHoursToMerge`). Null = no sample. */
  hoursToMerge: number | null;
  /** Share of the day's governance-READABLE scans whose default branch is protected. Null when no
   *  scan that day could read governance (never a measured 0 — "couldn't read" ≠ "unprotected"). */
  protectedRate: number | null;
  /** True when EVERY scan behind this point came from the deterministic mock engine. Such a point is
   *  not comparable to a live-scored one, and the chart draws it hollow rather than asserting it is. */
  mock: boolean;
}

/**
 * A rate-of-change read on ONE metric's series.
 *
 * DELIBERATELY NARROW. It is fit by `forecastTrajectory` — the same OLS the maturity trend uses — but
 * only the *slope* fields survive to the consumer. `Forecast` also carries `currentLevel` /
 * `projectedLevel` / `eta`, which are MATURITY-MODEL semantics (L1..L5 bands over a 0-100 maturity
 * score). Review coverage is not a maturity score, so projecting it into "L4 in ~6 weeks" would be a
 * category error dressed as a forecast. Narrowing here, at the producer, means no consumer can render
 * it by accident — the same "enforce it where the data is made" pattern the contributor privacy floor
 * uses.
 */
export interface DeliveryRateFit {
  metric: DeliveryMetricKey;
  /** Change in the metric's own unit per week, rounded to 0.1. */
  perWeek: number;
  trajectory: Trajectory;
  /** Distinct calendar days behind the fit. */
  points: number;
  /** Calendar span of the fit, in days. */
  spanDays: number;
  /**
   * Non-null when the SHARED forecast floor (`MIN_FORECAST_POINTS` distinct days AND
   * `MIN_FORECAST_SPAN_DAYS` of calendar span) is not met — copy-ready, render it verbatim INSTEAD of
   * the rate. "We don't project from a 5-day sample" means the same thing here as on the trends page
   * and the org rollup because it is literally the same gate.
   */
  insufficiency: string | null;
}

export interface OrgDeliveryTrend {
  points: DeliveryTrendPoint[];
  /** Distinct repos contributing anywhere in the window. */
  repos: number;
  /** Scans behind the whole trend. */
  scans: number;
  /** The effective lower bound actually queried (ISO) after the retention clamp; null = all time. */
  since: string | null;
  /** True when the retention clamp — not the chosen window — set that lower bound. */
  retentionClamped: boolean;
  /** Slope reads for the two governance headline metrics, gated by the shared insufficiency floor. */
  fits: DeliveryRateFit[];
}

/** Metrics we publish a slope for. Deliberately the two "is delivery governed?" rates — the ones a
 *  leader acts on — not every series on the chart. */
export const DELIVERY_FIT_METRICS: DeliveryMetricKey[] = ["reviewedRate", "aiGovernedRate"];

/** A finite number, or null. Guards a drifted/garbage blob field from poisoning a weighted mean. */
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

interface DayAcc {
  scans: number;
  repos: Set<string>;
  live: number;
  analyzed: number;
  sum: Record<"mergeRate" | "reviewedRate" | "aiInvolvedRate" | "aiGovernedRate", number>;
  weight: Record<"mergeRate" | "reviewedRate" | "aiInvolvedRate" | "aiGovernedRate", number>;
  ttm: number[];
  govReadable: number;
  govProtected: number;
}

const PR_RATES = ["mergeRate", "reviewedRate", "aiInvolvedRate", "aiGovernedRate"] as const;

function emptyDay(): DayAcc {
  return {
    scans: 0,
    repos: new Set<string>(),
    live: 0,
    analyzed: 0,
    sum: { mergeRate: 0, reviewedRate: 0, aiInvolvedRate: 0, aiGovernedRate: 0 },
    weight: { mergeRate: 0, reviewedRate: 0, aiInvolvedRate: 0, aiGovernedRate: 0 },
    ttm: [],
    govReadable: 0,
    govProtected: 0,
  };
}

/**
 * Fold historical scan rows into one point per calendar day. PURE — no I/O, no clock, no Prisma — so
 * the bucketing, the weighting, and the null-vs-zero discipline are all unit-testable directly.
 * Malformed blobs are skipped exactly as the point-in-time aggregators skip them (a bad blob must
 * never throw, and must never silently enter a denominator).
 */
export function buildDeliveryTrend(rows: readonly DeliveryScanRow[], tz: string = orgTimeZone()): DeliveryTrendPoint[] {
  const byDay = new Map<string, DayAcc>();

  for (const row of rows) {
    if (!(row.scannedAt instanceof Date) || Number.isNaN(row.scannedAt.getTime())) continue;
    const key = dayKeyInZone(row.scannedAt, tz);

    let pr: PrStats | null = null;
    if (row.prStats) {
      try {
        const parsed = JSON.parse(row.prStats) as PrStats;
        if ((num(parsed?.analyzed) ?? 0) > 0) pr = parsed;
      } catch {
        /* malformed blob — skip, never throw */
      }
    }

    let govProtected: boolean | null = null;
    if (row.governance) {
      try {
        const g = JSON.parse(row.governance) as { readable?: boolean; protected?: boolean };
        // "Couldn't read governance" is not "unprotected" — an unreadable blob contributes nothing.
        if (g?.readable === true) govProtected = g.protected === true;
      } catch {
        /* malformed blob — skip */
      }
    }

    // A scan with neither usable blob has nothing to say about delivery; it must not inflate the
    // day's sample size (which the UI presents as "what's behind this point").
    if (!pr && govProtected === null) continue;

    const acc = byDay.get(key) ?? emptyDay();
    acc.scans += 1;
    acc.repos.add(row.repoId);
    if (row.engineProvider !== MOCK_ENGINE) acc.live += 1;

    if (pr) {
      const analyzed = num(pr.analyzed) ?? 0;
      acc.analyzed += analyzed;
      for (const k of PR_RATES) {
        const v = num(pr[k]);
        if (v === null) continue; // "no sample" — not a measured 0
        acc.sum[k] += v * analyzed;
        acc.weight[k] += analyzed;
      }
      const ttm = num(pr.medianHoursToMerge);
      if (ttm !== null) acc.ttm.push(ttm);
    }
    if (govProtected !== null) {
      acc.govReadable += 1;
      if (govProtected) acc.govProtected += 1;
    }

    byDay.set(key, acc);
  }

  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, a]) => {
      const rate = (k: (typeof PR_RATES)[number]) => (a.weight[k] > 0 ? Math.round(a.sum[k] / a.weight[k]) : null);
      return {
        date,
        scans: a.scans,
        repos: a.repos.size,
        prs: a.analyzed,
        mergeRate: rate("mergeRate"),
        reviewedRate: rate("reviewedRate"),
        aiInvolvedRate: rate("aiInvolvedRate"),
        aiGovernedRate: rate("aiGovernedRate"),
        hoursToMerge: a.ttm.length ? Math.round((a.ttm.reduce((x, y) => x + y, 0) / a.ttm.length) * 10) / 10 : null,
        protectedRate: a.govReadable > 0 ? Math.round((a.govProtected / a.govReadable) * 100) : null,
        // Hollow only when the day has NO live scan at all — one live scan makes the day's aggregate
        // a real (if mixed) measurement, and the note under the chart explains the mix.
        mock: a.live === 0,
      } satisfies DeliveryTrendPoint;
    });
}

/**
 * Slope read for one metric, behind the SHARED forecast floor. PURE.
 *
 * Days where the metric is null (no sample) are dropped rather than zero-filled — a day nobody
 * measured review coverage is not a day review coverage was 0%, and zero-filling would manufacture a
 * crash-and-recover the fleet never experienced.
 */
export function buildDeliveryRateFit(points: readonly DeliveryTrendPoint[], metric: DeliveryMetricKey): DeliveryRateFit {
  const series = points
    .map((p) => ({ date: p.date, value: p[metric] }))
    .filter((p): p is { date: string; value: number } => p.value !== null);
  const f = forecastTrajectory(series);
  const insufficiency = forecastInsufficiency(f);
  return {
    metric,
    perWeek: f?.perWeek ?? 0,
    trajectory: f?.trajectory ?? "flat",
    points: f?.points ?? series.length,
    spanDays: f?.spanDays ?? 0,
    insufficiency,
  };
}

/**
 * Windowed delivery trend for an org. Segment + tech-group scoped like every other Delivery panel, so
 * the trend answers the same question the tables above it do. Null when the DB is off, the org is
 * unknown, or no scan in the window carried a usable PR/governance blob.
 */
export async function getOrgDeliveryTrend(
  orgSlug: string,
  window?: OrgWindow,
  segmentId?: string | null,
  techGroupId?: string | null,
): Promise<OrgDeliveryTrend | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const start = window?.start ?? null;
  const end = window?.end ?? null;
  // Same retention floor as the maturity trend: never look back further than the plan buys.
  const retentionStart = retentionCutoff(org.plan, Date.now());
  const lower = retentionStart && (!start || retentionStart > start) ? retentionStart : start;

  const scans = await prisma.scan.findMany({
    where: {
      repo: { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) },
      ...dateRange(lower, end),
    },
    select: { scannedAt: true, engineProvider: true, prStats: true, governance: true, repoId: true },
    orderBy: { scannedAt: "asc" },
  });

  const points = buildDeliveryTrend(scans);
  if (!points.length) return null;

  const repoIds = new Set<string>();
  for (const s of scans) repoIds.add(s.repoId);

  return {
    points,
    repos: repoIds.size,
    scans: points.reduce((a, p) => a + p.scans, 0),
    since: lower ? lower.toISOString() : null,
    retentionClamped: Boolean(retentionStart && (!start || retentionStart > start)),
    fits: DELIVERY_FIT_METRICS.map((m) => buildDeliveryRateFit(points, m)),
  };
}
