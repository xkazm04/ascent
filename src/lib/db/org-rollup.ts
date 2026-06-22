// Org rollup: org-id resolution, per-repo watch/level state, and the org-rollup query that powers
// the dashboard. All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { forecastTrajectory, type Forecast } from "@/lib/maturity/forecast";
import { segmentScope, techGroupScope } from "@/lib/db/org-shared";
import { retentionCutoff } from "@/lib/plans";
import { parseTechStackJson } from "@/lib/analyze/tech-extract";
import type { TechStack } from "@/lib/types";

/** Pull just the two branch-protection fields the fleet gate needs out of a persisted governance
 *  JSON blob. Returns undefined for a null/missing/malformed blob (no-token scan, parse error) so the
 *  gate leaves `requireProtectedBranch` unevaluated rather than false-failing. */
function parseGovernanceLite(raw: string | null | undefined): { readable: boolean; protected: boolean } | undefined {
  if (!raw) return undefined;
  try {
    const g = JSON.parse(raw) as { readable?: unknown; protected?: unknown };
    if (typeof g.readable !== "boolean") return undefined;
    return { readable: g.readable, protected: g.protected === true };
  } catch {
    return undefined;
  }
}

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
  /** GitHub's detected primary language, or null — drives auto-segments by language. */
  primaryLanguage: string | null;
  /** Detected tech stack (Feature 3a), cached from the latest scan — null until first scan / if absent.
   *  Drives tech badges on the leaderboard + tech-based grouping. */
  techStack: TechStack | null;
  scanSchedule: string;
  lastScanAt: string | null;
  /** Outcome of the most recent scan attempt — "ok" | "error" | null (never attempted). */
  lastScanStatus: string | null;
  /** Failure reason when lastScanStatus is "error", for a "needs attention" affordance. */
  lastScanError: string | null;
  /** `.ai/` standard conformance % reported by the repo's doctor, or null if never reported. */
  aiConformance: number | null;
  latest: {
    level: string;
    overall: number;
    adoption: number;
    rigor: number;
    posture: string;
    scannedAt: string;
    dims: { dimId: string; score: number }[];
    /** Whether a token saw the default branch's protection rules (governance.readable). Undefined
     *  when no governance blob was persisted. Lets the fleet gate enforce `requireProtectedBranch`
     *  with the SAME readable-gated semantics as the CI gate (evaluateGate). */
    govReadable?: boolean;
    /** Whether the default branch is protected (governance.protected), when readable. */
    protected?: boolean;
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
  /** Cohort-matched current-minus-baseline for the headline metrics — the per-tile period delta.
   * Measured only over repos present on BOTH sides of the window, so onboarding repos mid-period
   * reads as growth, not fabricated score movement. Null without a baseline (or no overlap). */
  deltas: { overall: number; adoption: number; rigor: number } | null;
}

/** One repo's score snapshot on one side of the window — input to `computeWindowDeltas`. */
export interface RepoScoreSnap {
  repoId: string;
  overall: number;
  adoption: number;
  rigor: number;
}

/**
 * Cohort-matched period deltas: movement is measured ONLY over repos present on BOTH sides of the
 * window. Averaging the whole current fleet against the baseline cohort folds composition change
 * into what is presented as score movement — onboarding 5 low-scoring repos mid-quarter used to
 * read as the fleet "slipping" 25 points no repo experienced (and onboarding strong repos
 * manufactured a fake climb), while the movers panel below correctly showed zero regressions.
 * Returns null when the cohorts don't overlap.
 */
export function computeWindowDeltas(
  current: readonly RepoScoreSnap[],
  baseline: readonly RepoScoreSnap[],
): { overall: number; adoption: number; rigor: number } | null {
  const currentIds = new Set(current.map((c) => c.repoId));
  const before = baseline.filter((b) => currentIds.has(b.repoId));
  const beforeIds = new Set(before.map((b) => b.repoId));
  const now = current.filter((c) => beforeIds.has(c.repoId));
  if (!before.length || !now.length) return null;
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  return {
    overall: avg(now.map((c) => c.overall)) - avg(before.map((b) => b.overall)),
    adoption: avg(now.map((c) => c.adoption)) - avg(before.map((b) => b.adoption)),
    rigor: avg(now.map((c) => c.rigor)) - avg(before.map((b) => b.rigor)),
  };
}

export async function getOrgRollup(orgSlug: string, window?: OrgWindow, segmentId?: string | null, techGroupId?: string | null): Promise<OrgRollup | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const start = window?.start ?? null;
  const end = window?.end ?? null;
  // Segment AND tech-group filters compose — both narrow the same repo set (Feature 3b).
  const seg = { ...segmentScope(segmentId), ...techGroupScope(techGroupId) };

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
    // Parse the persisted default-branch governance blob so the fleet gate can enforce
    // `requireProtectedBranch` (governance fleet view) with the same readable-gated semantics as the
    // CI gate — previously the rollup carried no protection data, so that bar was silently dead in
    // the dashboard while the copyable CI snippet enforced it (dashboard↔CI drift).
    const gov = parseGovernanceLite(s?.governance);
    return {
      fullName: r.fullName,
      owner: r.owner,
      name: r.name,
      isPrivate: r.isPrivate,
      watched: r.watched,
      primaryLanguage: r.primaryLanguage ?? null,
      techStack: parseTechStackJson(r.techStackJson),
      scanSchedule: r.scanSchedule,
      lastScanAt: r.lastScanAt ? r.lastScanAt.toISOString() : null,
      lastScanStatus: r.lastScanStatus,
      lastScanError: r.lastScanError,
      aiConformance: r.aiConformance ?? null,
      latest: s
        ? {
            level: s.level,
            overall: s.overallScore,
            adoption: s.adoptionScore,
            rigor: s.rigorScore,
            posture: s.posture,
            scannedAt: s.scannedAt.toISOString(),
            dims: s.dimensions,
            govReadable: gov?.readable,
            protected: gov?.protected,
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

  // Org maturity trend: avg overall per day across scans within the window. The lower bound is also
  // clamped to the plan's retention window — a NON-DESTRUCTIVE read floor — so the trajectory looks back
  // only as far as the tier buys (Free 30d · Pro 180d · Team 365d · Enterprise unlimited). The current
  // fleet snapshot above is untouched: retention caps HISTORY depth, not today's number. (CRED retention.)
  const retentionStart = retentionCutoff(org.plan, Date.now());
  const trendStart = retentionStart && (!start || retentionStart > start) ? retentionStart : start;
  const allScans = await prisma.scan.findMany({
    where: {
      repo: { orgId: org.id, ...seg },
      ...(trendStart || end ? { scannedAt: { ...(trendStart ? { gte: trendStart } : {}), ...(end ? { lte: end } : {}) } } : {}),
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
  // Powers the per-tile period delta and the period-in-review banner. Deltas are cohort-matched
  // (computeWindowDeltas): the tiles keep the fleet-wide averages as their main values, but the
  // movement number compares only repos that exist on both sides of the window.
  let baseline: OrgRollup["baseline"] = null;
  let deltas: OrgRollup["deltas"] = null;
  if (start) {
    const priorScans = await prisma.scan.findMany({
      // Half-open window: the baseline is scans STRICTLY before `start`, while the in-window trend uses
      // `gte: start` (above). A scan whose timestamp is exactly `start` (e.g. seed/snapshot data at a
      // clean local midnight) previously counted as BOTH the baseline and the first in-window point —
      // comparing it against itself for a spurious 0-delta. `lt` makes each scan land on one side only.
      where: { repo: { orgId: org.id, ...seg }, scannedAt: { lt: start } },
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
      const currentSnaps: RepoScoreSnap[] = repos
        .filter((r) => r.scans[0])
        .map((r) => ({
          repoId: r.id,
          overall: r.scans[0]!.overallScore,
          adoption: r.scans[0]!.adoptionScore,
          rigor: r.scans[0]!.rigorScore,
        }));
      deltas = computeWindowDeltas(
        currentSnaps,
        latestPerRepo.map((s) => ({ repoId: s.repoId, overall: s.overallScore, adoption: s.adoptionScore, rigor: s.rigorScore })),
      );
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

/** One inference engine's share of an org's scans over a window. */
export interface EngineMixEntry {
  provider: string;
  count: number;
}

/**
 * Count the org's scans by inference engine over the window — the provenance behind the period's
 * scores. Surfacing it on the durable briefing makes a mock-degraded quarter (a live model that fell
 * back to the deterministic mock) auditable, not just visible in the transient scan stream (DIANE).
 * Sorted by count desc; empty when the DB is off or the org has no scans.
 */
export async function getOrgEngineMix(orgSlug: string, window?: OrgWindow, segmentId?: string | null, techGroupId?: string | null): Promise<EngineMixEntry[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return [];
  const start = window?.start ?? null;
  const end = window?.end ?? null;
  const groups = await prisma.scan.groupBy({
    by: ["engineProvider"],
    where: {
      repo: { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) },
      ...(start || end ? { scannedAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}),
    },
    _count: true,
  });
  return groups
    .map((g) => ({ provider: g.engineProvider, count: g._count as number }))
    .sort((a, b) => b.count - a.count);
}

/** How many recommendations the org ACTIONED in the window — engagement (any status change) and
 *  completion (→ done). With the rollup's points-moved + level promotions this answers the renewal
 *  question "did anyone act on this, and did it move the number?" (TANIA). Counts RecommendationEvent
 *  status changes joined org → repo → scan → recommendation; segment-scoped like the rest. */
export async function getOrgRecsActioned(
  orgSlug: string,
  window?: OrgWindow,
  segmentId?: string | null,
  techGroupId?: string | null,
): Promise<{ engaged: number; actioned: number }> {
  if (!isDbConfigured()) return { engaged: 0, actioned: 0 };
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return { engaged: 0, actioned: 0 };
  const start = window?.start ?? null;
  const end = window?.end ?? null;
  const scope = {
    kind: "status",
    ...(start || end ? { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}),
    recommendation: { scan: { repo: { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) } } },
  };
  const [engaged, actioned] = await Promise.all([
    prisma.recommendationEvent.count({ where: scope }),
    prisma.recommendationEvent.count({ where: { ...scope, toValue: "done" } }),
  ]);
  return { engaged, actioned };
}
