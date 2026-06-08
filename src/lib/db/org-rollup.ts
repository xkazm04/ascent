// Org rollup: org-id resolution, per-repo watch/level state, and the org-rollup query that powers
// the dashboard. All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { forecastTrajectory, type Forecast } from "@/lib/maturity/forecast";
import { segmentScope } from "@/lib/db/org-shared";

/** Resolve an org slug to its id (the tenant scope), or null when it doesn't exist. */
export async function getOrgId(slug: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const org = await getPrisma().organization.findUnique({ where: { slug }, select: { id: true } });
  return org?.id ?? null;
}

export interface RepoState {
  watched: boolean;
  scanSchedule: string;
  level: string | null;
  overall: number | null;
}

/** Per-fullName watch/schedule/latest-level state, to merge into an installation listing. */
export async function getRepoStates(orgSlug: string): Promise<Record<string, RepoState>> {
  if (!isDbConfigured()) return {};
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return {};
  const repos = await prisma.repository.findMany({
    where: { orgId: org.id },
    select: {
      fullName: true,
      watched: true,
      scanSchedule: true,
      scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { level: true, overallScore: true } },
    },
  });
  const out: Record<string, RepoState> = {};
  for (const r of repos)
    out[r.fullName] = {
      watched: r.watched,
      scanSchedule: r.scanSchedule,
      level: r.scans[0]?.level ?? null,
      overall: r.scans[0]?.overallScore ?? null,
    };
  return out;
}

export interface OrgRepoRow {
  fullName: string;
  owner: string;
  name: string;
  isPrivate: boolean;
  watched: boolean;
  scanSchedule: string;
  lastScanAt: string | null;
  /** Outcome of the most recent scan attempt — "ok" | "error" | null (never attempted). */
  lastScanStatus: string | null;
  /** Failure reason when lastScanStatus is "error", for a "needs attention" affordance. */
  lastScanError: string | null;
  latest: {
    level: string;
    overall: number;
    adoption: number;
    rigor: number;
    posture: string;
    scannedAt: string;
    dims: { dimId: string; score: number }[];
  } | null;
}

/**
 * A time window for the org views. `start` doubles as the *baseline date* for period-over-period
 * deltas (the fleet snapshot we compare the present against); `end` bounds the present (null = now).
 * Omitting the window entirely preserves the all-time behavior (no baseline, full trend).
 */
export interface OrgWindow {
  start?: Date | null;
  end?: Date | null;
}

export interface OrgRollup {
  org: string;
  repoCount: number;
  scannedCount: number;
  avgOverall: number;
  avgAdoption: number;
  avgRigor: number;
  postureCounts: Record<string, number>;
  dimAverages: { dimId: string; avg: number }[];
  repos: OrgRepoRow[];
  trend: { date: string; avg: number }[];
  /** Forward-looking trajectory fit over `trend` — projected level + promotion/demotion ETA.
   * Null until there are at least two distinct scan days to fit a line through. */
  forecast: Forecast | null;
  /** Fleet snapshot as of the window's `start` (latest scan per repo at-or-before that date).
   * Null when no window start is given or no repo had been scanned by then. */
  baseline: {
    asOf: string; // ISO of the baseline date
    repos: number; // repos that had a scan by then
    avgOverall: number;
    avgAdoption: number;
    avgRigor: number;
  } | null;
  /** Current minus baseline for the headline metrics — the per-tile period delta. Null without a baseline. */
  deltas: { overall: number; adoption: number; rigor: number } | null;
}

export async function getOrgRollup(orgSlug: string, window?: OrgWindow, segmentId?: string | null): Promise<OrgRollup | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const start = window?.start ?? null;
  const end = window?.end ?? null;
  const seg = segmentScope(segmentId);

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...seg, OR: [{ watched: true }, { scans: { some: {} } }] },
    include: {
      scans: {
        // Bound the "current" snapshot to the window end (almost always now) so a custom range
        // that ends in the past reflects the fleet as it stood then.
        where: end ? { scannedAt: { lte: end } } : undefined,
        orderBy: { scannedAt: "desc" },
        take: 1,
        include: { dimensions: { select: { dimId: true, score: true } } },
      },
    },
    orderBy: { fullName: "asc" },
  });

  const rows: OrgRepoRow[] = repos.map((r) => {
    const s = r.scans[0];
    return {
      fullName: r.fullName,
      owner: r.owner,
      name: r.name,
      isPrivate: r.isPrivate,
      watched: r.watched,
      scanSchedule: r.scanSchedule,
      lastScanAt: r.lastScanAt ? r.lastScanAt.toISOString() : null,
      lastScanStatus: r.lastScanStatus,
      lastScanError: r.lastScanError,
      latest: s
        ? {
            level: s.level,
            overall: s.overallScore,
            adoption: s.adoptionScore,
            rigor: s.rigorScore,
            posture: s.posture,
            scannedAt: s.scannedAt.toISOString(),
            dims: s.dimensions,
          }
        : null,
    };
  });

  const scanned = rows.filter((r) => r.latest);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const postureCounts: Record<string, number> = {};
  for (const r of scanned) postureCounts[r.latest!.posture] = (postureCounts[r.latest!.posture] ?? 0) + 1;

  const dimSum: Record<string, { sum: number; n: number }> = {};
  for (const r of scanned)
    for (const d of r.latest!.dims) {
      const entry = (dimSum[d.dimId] = dimSum[d.dimId] || { sum: 0, n: 0 });
      entry.sum += d.score;
      entry.n += 1;
    }
  const dimAverages = Object.keys(dimSum)
    .sort()
    .map((dimId) => {
      const entry = dimSum[dimId]!; // safe: dimId comes from Object.keys(dimSum)
      return { dimId, avg: Math.round(entry.sum / entry.n) };
    });

  // Org maturity trend: avg overall per day across scans within the window.
  const allScans = await prisma.scan.findMany({
    where: {
      repo: { orgId: org.id, ...seg },
      ...(start || end ? { scannedAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}),
    },
    select: { scannedAt: true, overallScore: true },
    orderBy: { scannedAt: "asc" },
  });
  const byDay: Record<string, { sum: number; n: number }> = {};
  for (const s of allScans) {
    const day = s.scannedAt.toISOString().slice(0, 10);
    byDay[day] = byDay[day] || { sum: 0, n: 0 };
    byDay[day].sum += s.overallScore;
    byDay[day].n += 1;
  }
  const trend = Object.keys(byDay)
    .sort()
    .map((date) => {
      const entry = byDay[date]!; // safe: date comes from Object.keys(byDay)
      return { date, avg: Math.round(entry.sum / entry.n) };
    });

  // Project where the org maturity trend is heading from its per-day history.
  const forecast = forecastTrajectory(trend.map((t) => ({ date: t.date, value: t.avg })));

  const avgOverall = avg(scanned.map((r) => r.latest!.overall));
  const avgAdoption = avg(scanned.map((r) => r.latest!.adoption));
  const avgRigor = avg(scanned.map((r) => r.latest!.rigor));

  // Baseline = the fleet as it stood at the window start: latest scan per repo at-or-before `start`.
  // Powers the per-tile period delta (current avg − baseline avg) and the period-in-review banner.
  let baseline: OrgRollup["baseline"] = null;
  let deltas: OrgRollup["deltas"] = null;
  if (start) {
    const priorScans = await prisma.scan.findMany({
      where: { repo: { orgId: org.id, ...seg }, scannedAt: { lte: start } },
      select: { repoId: true, overallScore: true, adoptionScore: true, rigorScore: true },
      orderBy: { scannedAt: "desc" },
    });
    const seen = new Set<string>();
    const latestPerRepo: typeof priorScans = [];
    for (const s of priorScans) {
      if (seen.has(s.repoId)) continue;
      seen.add(s.repoId);
      latestPerRepo.push(s);
    }
    if (latestPerRepo.length) {
      baseline = {
        asOf: start.toISOString(),
        repos: latestPerRepo.length,
        avgOverall: avg(latestPerRepo.map((s) => s.overallScore)),
        avgAdoption: avg(latestPerRepo.map((s) => s.adoptionScore)),
        avgRigor: avg(latestPerRepo.map((s) => s.rigorScore)),
      };
      deltas = {
        overall: avgOverall - baseline.avgOverall,
        adoption: avgAdoption - baseline.avgAdoption,
        rigor: avgRigor - baseline.avgRigor,
      };
    }
  }

  return {
    org: orgSlug,
    repoCount: rows.length,
    scannedCount: scanned.length,
    avgOverall,
    avgAdoption,
    avgRigor,
    postureCounts,
    dimAverages,
    repos: rows,
    trend,
    forecast,
    baseline,
    deltas,
  };
}
