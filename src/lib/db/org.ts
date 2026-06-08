// Enterprise org layer: watchlist, scan scheduling, and the org-rollup query that powers
// the dashboard. All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { DIMENSION_BY_ID, postureFor, weightsFor } from "@/lib/maturity/model";
import { forecastTrajectory, type Forecast } from "@/lib/maturity/forecast";
import { teamDisplayName } from "@/lib/github/codeowners";
import { PRACTICES } from "@/lib/practices";
import type { DimensionId, PrStats } from "@/lib/types";

const LEVEL_RANK: Record<string, number> = { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };
const IMPACT_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };

const SCHEDULE_DAYS: Record<string, number> = { off: 0, daily: 1, weekly: 7, monthly: 30 };

function nextScanFor(schedule: string): Date | null {
  const d = SCHEDULE_DAYS[schedule] ?? 0;
  return d > 0 ? new Date(Date.now() + d * 86_400_000) : null;
}

/**
 * Repo-level where-fragment that scopes an aggregate to a custom segment (a user-defined tag on
 * repos — see src/lib/db/segments.ts). Empty when no segment is selected, so every aggregate stays
 * fleet-wide by default. AND-combines with the existing `orgId` filter, so a segment id from another
 * org matches no repos rather than leaking across tenants.
 */
function segmentScope(segmentId?: string | null) {
  return segmentId ? { segments: { some: { segmentId } } } : {};
}

/** Resolve an org slug to its id (the tenant scope), or null when it doesn't exist. */
export async function getOrgId(slug: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const org = await getPrisma().organization.findUnique({ where: { slug }, select: { id: true } });
  return org?.id ?? null;
}

/** Is a repo watched (the gate for push-triggered re-scans)? False when DB off or repo unknown. */
export async function isRepoWatched(orgSlug: string, fullName: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return false;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId: org.id, fullName } },
    select: { watched: true },
  });
  return Boolean(repo?.watched);
}

async function ensureOrg(slug: string) {
  return getPrisma().organization.upsert({
    where: { slug },
    update: {},
    create: { slug, name: slug === "public" ? "Public Scans" : slug, plan: "private" },
  });
}

export interface RepoRef {
  owner: string;
  name: string;
  fullName: string;
  url?: string;
  isPrivate?: boolean;
  /** ISO of the repo's last scan, when known — lets a bulk scan skip still-fresh repos. */
  lastScanAt?: string | null;
}

/** Upsert a repo (from an installation listing) and set its watched flag. */
export async function setRepoWatch(orgSlug: string, repo: RepoRef, watched: boolean): Promise<void> {
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  const org = await ensureOrg(orgSlug);
  await prisma.repository.upsert({
    where: { orgId_fullName: { orgId: org.id, fullName: repo.fullName } },
    update: { watched, url: repo.url ?? undefined, isPrivate: repo.isPrivate ?? undefined },
    create: {
      orgId: org.id,
      owner: repo.owner,
      name: repo.name,
      fullName: repo.fullName,
      url: repo.url ?? `https://github.com/${repo.fullName}`,
      isPrivate: repo.isPrivate ?? false,
      watched,
    },
  });
}

export async function setRepoSchedule(orgSlug: string, fullName: string, schedule: string): Promise<void> {
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return;
  await prisma.repository.updateMany({
    where: { orgId: org.id, fullName },
    data: { scanSchedule: schedule, nextScanAt: nextScanFor(schedule) },
  });
}

/**
 * Pre-populate an org's watchlist from login-time auto-discovery: upsert each repo as WATCHED on a
 * weekly schedule, due immediately (nextScanAt = now) so the autoscan cron — or the dashboard's
 * "Scan all watched" — fills in scores on its next pass. This turns a brand-new user's blank org
 * view into one with a real fleet to act on (its rollup and trends populate once those seeded
 * repos are scanned).
 *
 * Idempotent and non-destructive: the upsert only WRITES on first sight (`update: {}`), so
 * re-running on each login never duplicates a repo and never overrides a watch/schedule the user
 * has since changed. Returns the number of repos processed; 0 (a no-op) when persistence is off or
 * no repos were supplied. Caller treats it as best-effort — a failure must not block sign-in.
 */
export async function seedWatchlist(orgSlug: string, repos: RepoRef[]): Promise<number> {
  if (!isDbConfigured() || repos.length === 0) return 0;
  const prisma = getPrisma();
  const org = await ensureOrg(orgSlug);
  const dueNow = new Date();
  let seeded = 0;
  for (const r of repos) {
    await prisma.repository.upsert({
      where: { orgId_fullName: { orgId: org.id, fullName: r.fullName } },
      update: {}, // respect any later user choice — only seed repos we've never recorded
      create: {
        orgId: org.id,
        owner: r.owner,
        name: r.name,
        fullName: r.fullName,
        url: r.url ?? `https://github.com/${r.fullName}`,
        isPrivate: r.isPrivate ?? false,
        watched: true,
        scanSchedule: "weekly",
        nextScanAt: dueNow,
      },
    });
    seeded += 1;
  }
  return seeded;
}

export interface DueRescan {
  orgSlug: string;
  fullName: string;
  repoId: string;
  scanSchedule: string;
}

/**
 * Repos whose autoscan is due (watched, scheduled, nextScanAt in the past), fairly interleaved
 * across orgs so one large fleet can't starve every other org within a single cron run.
 *
 * A pure `orderBy nextScanAt asc` + `take` lets the single most-overdue org monopolize each run, so
 * past `limit` due repos the back of the fleet never gets scanned. Instead we fetch a wider candidate
 * set (still oldest-due first), group by org, and round-robin across orgs — each run spreads work
 * fleet-wide while still preferring the most-overdue repo within each org.
 */
export async function listDueRescans(limit = 100): Promise<DueRescan[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const due = await prisma.repository.findMany({
    where: { watched: true, scanSchedule: { not: "off" }, nextScanAt: { lte: new Date() } },
    select: { id: true, fullName: true, scanSchedule: true, org: { select: { slug: true } } },
    orderBy: { nextScanAt: "asc" },
    take: limit * 4, // wider candidate pool to interleave; capped back to `limit` below
  });
  const byOrg = new Map<string, DueRescan[]>();
  for (const r of due) {
    const item: DueRescan = { orgSlug: r.org.slug, fullName: r.fullName, repoId: r.id, scanSchedule: r.scanSchedule };
    const q = byOrg.get(item.orgSlug);
    if (q) q.push(item);
    else byOrg.set(item.orgSlug, [item]);
  }
  const queues = [...byOrg.values()];
  const out: DueRescan[] = [];
  for (let i = 0; out.length < limit && queues.some((q) => q.length > 0); i++) {
    const next = queues[i % queues.length].shift();
    if (next) out.push(next);
  }
  return out;
}

/** After a SUCCESSFUL autoscan, advance the repo's next due time by its full cadence. */
export async function advanceSchedule(repoId: string, schedule: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().repository.update({ where: { id: repoId }, data: { nextScanAt: nextScanFor(schedule) } });
}

/** Retry backoff after a FAILED autoscan. Critical for queue fairness: the schedule used to advance
 *  only on success, so a persistently-broken repo (revoked token, deleted repo) stayed permanently
 *  due at the front of the oldest-first queue and re-failed every run, crowding out healthy repos.
 *  Pushing nextScanAt a fixed backoff out moves it off the front and retries it on a later cron,
 *  without waiting the full cadence. */
const FAILED_RESCAN_BACKOFF_MS = 6 * 60 * 60_000; // 6h
export async function advanceScheduleAfterFailure(repoId: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().repository.update({
    where: { id: repoId },
    data: { nextScanAt: new Date(Date.now() + FAILED_RESCAN_BACKOFF_MS) },
  });
}

/** Watched repos for an org (for bulk scan / cron). */
export async function listWatchedRepos(orgSlug: string): Promise<RepoRef[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return [];
  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, watched: true },
    select: { owner: true, name: true, fullName: true, url: true, isPrivate: true, lastScanAt: true },
    orderBy: { fullName: "asc" },
  });
  return repos.map((r) => ({
    owner: r.owner,
    name: r.name,
    fullName: r.fullName,
    url: r.url,
    isPrivate: r.isPrivate,
    lastScanAt: r.lastScanAt ? r.lastScanAt.toISOString() : null,
  }));
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

export interface OrgContributor {
  login: string;
  name: string | null;
  commits: number;
  aiCommits: number;
  repos: number;
}

/** Contributors aggregated across the org's repos — for the 'who is AI-native' view. */
export async function getOrgContributors(orgSlug: string, segmentId?: string | null): Promise<OrgContributor[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return [];
  const rows = await prisma.repoContributor.findMany({
    where: { repo: { orgId: org.id, ...segmentScope(segmentId) } },
    select: { login: true, name: true, commits: true, aiCommits: true },
  });
  const map = new Map<string, OrgContributor>();
  for (const r of rows) {
    const e = map.get(r.login) ?? { login: r.login, name: r.name, commits: 0, aiCommits: 0, repos: 0 };
    e.commits += r.commits;
    e.aiCommits += r.aiCommits;
    e.repos += 1;
    if (!e.name) e.name = r.name;
    map.set(r.login, e);
  }
  return [...map.values()].filter((c) => c.login !== "unknown").sort((a, b) => b.commits - a.commits);
}

// ── Contributor intelligence (F5) ────────────────────────────────────────────
// All derived from the stored RepoContributor snapshots (latest scan per repo) — no extra
// GitHub calls. "commits"/"aiCommits" reflect the recent-activity window we capture at scan
// time. Bots ([bot]) and unattributed ("unknown") commits are excluded from the human view.

const isBot = (login: string) => /\[bot\]$/i.test(login) || login === "unknown";

export interface ContributorInsight {
  login: string;
  name: string | null;
  commits: number;
  aiCommits: number;
  aiShare: number; // 0..100, share of this person's commits that are AI-attributed
  repos: number; // distinct repos touched
  repoNames: string[]; // sorted by that person's commits desc
  lastActiveAt: string | null;
  championScore: number; // AI adoption × breadth × volume (for ranking culture carriers)
}

export interface RepoConcentration {
  fullName: string;
  name: string;
  contributorCount: number;
  totalCommits: number;
  topLogin: string;
  topShare: number; // 0..100, the top contributor's share of commits
  busFactor: number; // # contributors needed to cover >50% of commits
  soloMaintainer: boolean; // 1 contributor, or top contributor owns ≥80%
}

export interface ContributorInsights {
  org: string;
  totalContributors: number;
  aiActive: number; // humans with ≥1 AI-attributed commit
  aiActiveShare: number; // 0..100
  orgAiShare: number; // 0..100, commit-weighted across all humans
  soloMaintainerCount: number;
  contributors: ContributorInsight[]; // all humans, sorted by commits desc
  champions: ContributorInsight[]; // top by championScore
  concentration: RepoConcentration[]; // per repo, sorted by topShare desc
}

/** Contributor involvement, AI-native profiles, champions, and bus-factor across an org. */
export async function getContributorInsights(orgSlug: string, segmentId?: string | null): Promise<ContributorInsights | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const rows = await prisma.repoContributor.findMany({
    where: { repo: { orgId: org.id, ...segmentScope(segmentId) } },
    select: {
      login: true,
      name: true,
      commits: true,
      aiCommits: true,
      lastActiveAt: true,
      repo: { select: { fullName: true, name: true } },
    },
  });

  // Per-contributor aggregation (humans only).
  const people = new Map<
    string,
    { login: string; name: string | null; commits: number; aiCommits: number; repos: Map<string, number>; last: Date | null }
  >();
  // Per-repo contributor lists (humans only) for concentration / bus factor.
  const repos = new Map<string, { name: string; entries: { login: string; commits: number }[] }>();

  for (const r of rows) {
    if (isBot(r.login)) continue;
    const p =
      people.get(r.login) ??
      { login: r.login, name: r.name, commits: 0, aiCommits: 0, repos: new Map<string, number>(), last: null };
    p.commits += r.commits;
    p.aiCommits += r.aiCommits;
    p.repos.set(r.repo.fullName, (p.repos.get(r.repo.fullName) ?? 0) + r.commits);
    if (!p.name && r.name) p.name = r.name;
    if (r.lastActiveAt && (!p.last || r.lastActiveAt > p.last)) p.last = r.lastActiveAt;
    people.set(r.login, p);

    const repo = repos.get(r.repo.fullName) ?? { name: r.repo.name, entries: [] };
    repo.entries.push({ login: r.login, commits: r.commits });
    repos.set(r.repo.fullName, repo);
  }

  const contributors: ContributorInsight[] = [...people.values()]
    .map((p) => {
      const aiShare = p.commits ? Math.round((p.aiCommits / p.commits) * 100) : 0;
      const repoCount = p.repos.size;
      const repoNames = [...p.repos.entries()].sort((a, b) => b[1] - a[1]).map(([fn]) => fn);
      // Reward AI adoption × breadth × (log) volume — culture carriers spread AI across repos.
      const championScore = (aiShare / 100) * Math.sqrt(repoCount) * Math.log2(p.commits + 1);
      return {
        login: p.login,
        name: p.name,
        commits: p.commits,
        aiCommits: p.aiCommits,
        aiShare,
        repos: repoCount,
        repoNames,
        lastActiveAt: p.last ? p.last.toISOString() : null,
        championScore: Math.round(championScore * 100) / 100,
      };
    })
    .sort((a, b) => b.commits - a.commits);

  const concentration: RepoConcentration[] = [...repos.entries()]
    .map(([fullName, { name, entries }]) => {
      const sorted = [...entries].sort((a, b) => b.commits - a.commits);
      const total = sorted.reduce((s, e) => s + e.commits, 0);
      let acc = 0;
      let busFactor = 0;
      for (const e of sorted) {
        acc += e.commits;
        busFactor += 1;
        if (acc > total / 2) break;
      }
      const topShare = total ? Math.round((sorted[0].commits / total) * 100) : 0;
      return {
        fullName,
        name,
        contributorCount: sorted.length,
        totalCommits: total,
        topLogin: sorted[0]?.login ?? "—",
        topShare,
        busFactor,
        soloMaintainer: sorted.length === 1 || topShare >= 80,
      };
    })
    .sort((a, b) => b.topShare - a.topShare);

  const totalCommits = contributors.reduce((s, c) => s + c.commits, 0);
  const aiCommitsTotal = contributors.reduce((s, c) => s + c.aiCommits, 0);
  const aiActive = contributors.filter((c) => c.aiCommits > 0).length;
  const champions = [...contributors]
    .filter((c) => c.commits >= 3 && c.aiCommits > 0)
    .sort((a, b) => b.championScore - a.championScore)
    .slice(0, 6);

  return {
    org: orgSlug,
    totalContributors: contributors.length,
    aiActive,
    aiActiveShare: contributors.length ? Math.round((aiActive / contributors.length) * 100) : 0,
    orgAiShare: totalCommits ? Math.round((aiCommitsTotal / totalCommits) * 100) : 0,
    soloMaintainerCount: concentration.filter((r) => r.soloMaintainer).length,
    contributors,
    champions,
    concentration,
  };
}

export interface OrgRepoRow {
  fullName: string;
  owner: string;
  name: string;
  isPrivate: boolean;
  watched: boolean;
  scanSchedule: string;
  lastScanAt: string | null;
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
      dimSum[d.dimId] = dimSum[d.dimId] || { sum: 0, n: 0 };
      dimSum[d.dimId].sum += d.score;
      dimSum[d.dimId].n += 1;
    }
  const dimAverages = Object.keys(dimSum)
    .sort()
    .map((dimId) => ({ dimId, avg: Math.round(dimSum[dimId].sum / dimSum[dimId].n) }));

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
    .map((date) => ({ date, avg: Math.round(byDay[date].sum / byDay[date].n) }));

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

export interface OrgPrSignals {
  repos: number; // repos that have PR data
  totalPrs: number; // PRs analyzed across the fleet
  avgMergeRate: number;
  avgReviewedRate: number;
  avgSmallPrRate: number;
  avgAiInvolvedRate: number;
  avgAiGovernedRate: number | null; // mean of repo aiGovernedRate (where it has a sample)
  typicalHoursToMerge: number | null; // mean of per-repo medians
  tools: { name: string; count: number }[];
}

// ── F1: history / movers ──────────────────────────────────────────────────────

export interface RepoMove {
  fullName: string;
  name: string;
  overall: number;
  dOverall: number;
  dAdoption: number;
  dRigor: number;
  levelFrom: string;
  levelTo: string;
  levelDelta: number; // +1 promoted, -1 demoted
  postureFrom: string;
  postureTo: string;
  sinceDays: number;
}

export interface OrgMovers {
  gainers: RepoMove[];
  regressers: RepoMove[];
  levelChanges: RepoMove[]; // promotions + demotions
  comparedRepos: number;
}

interface ScanLite {
  overallScore: number;
  adoptionScore: number;
  rigorScore: number;
  level: string;
  posture: string;
  scannedAt: Date;
}

/** Construct a RepoMove from a baseline (`prev`) and current (`now`) scan of one repo. */
function buildMove(fullName: string, name: string, now: ScanLite, prev: ScanLite): RepoMove {
  return {
    fullName,
    name,
    overall: now.overallScore,
    dOverall: now.overallScore - prev.overallScore,
    dAdoption: now.adoptionScore - prev.adoptionScore,
    dRigor: now.rigorScore - prev.rigorScore,
    levelFrom: prev.level,
    levelTo: now.level,
    levelDelta: (LEVEL_RANK[now.level] ?? 0) - (LEVEL_RANK[prev.level] ?? 0),
    postureFrom: prev.posture,
    postureTo: now.posture,
    sinceDays: Math.max(0, Math.round((now.scannedAt.getTime() - prev.scannedAt.getTime()) / 86_400_000)),
  };
}

/**
 * Per-repo change over a window — the "what moved" view. With a `window.start`, each repo's
 * latest scan (≤ end) is compared to its baseline (latest scan ≤ start), so movers reflect the
 * selected period. Without a window, it falls back to the two most recent scans ("since last scan").
 */
export async function getOrgMovers(orgSlug: string, window?: OrgWindow, segmentId?: string | null): Promise<OrgMovers | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const start = window?.start ?? null;
  const end = window?.end ?? null;
  const seg = segmentScope(segmentId);
  const moves: RepoMove[] = [];

  if (start) {
    // Windowed: fetch every in-window scan (one lightweight query), group per repo, then pick the
    // latest as "now" and the latest at-or-before `start` as the baseline.
    const rows = await prisma.scan.findMany({
      where: { repo: { orgId: org.id, ...seg }, ...(end ? { scannedAt: { lte: end } } : {}) },
      select: {
        repoId: true,
        overallScore: true,
        adoptionScore: true,
        rigorScore: true,
        level: true,
        posture: true,
        scannedAt: true,
        repo: { select: { fullName: true, name: true } },
      },
      orderBy: { scannedAt: "desc" },
    });
    const byRepo = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = byRepo.get(r.repoId) ?? [];
      arr.push(r);
      byRepo.set(r.repoId, arr);
    }
    for (const arr of byRepo.values()) {
      const now = arr[0]; // latest (rows are scannedAt desc)
      const prev = arr.find((s) => s.scannedAt <= start);
      if (!prev || prev === now) continue; // no baseline, or nothing moved within the window
      moves.push(buildMove(now.repo.fullName, now.repo.name, now, prev));
    }
  } else {
    const repos = await prisma.repository.findMany({
      where: { orgId: org.id, ...seg },
      select: {
        fullName: true,
        name: true,
        scans: {
          orderBy: { scannedAt: "desc" },
          take: 2,
          select: { overallScore: true, adoptionScore: true, rigorScore: true, level: true, posture: true, scannedAt: true },
        },
      },
    });
    for (const r of repos) {
      if (r.scans.length < 2) continue;
      const [now, prev] = r.scans;
      moves.push(buildMove(r.fullName, r.name, now, prev));
    }
  }

  return {
    gainers: moves.filter((m) => m.dOverall > 0).sort((a, b) => b.dOverall - a.dOverall),
    regressers: moves.filter((m) => m.dOverall < 0).sort((a, b) => a.dOverall - b.dOverall),
    levelChanges: moves.filter((m) => m.levelDelta !== 0).sort((a, b) => b.levelDelta - a.levelDelta),
    comparedRepos: moves.length,
  };
}

// ── F2: org-level recommendations ─────────────────────────────────────────────

export interface OrgRec {
  title: string;
  dimId: string;
  impact: string;
  repoCount: number;
  repos: string[];
  leverage: number;
}

/** Aggregate open recommendations across the fleet's latest scans → highest-leverage moves. */
export async function getOrgRecommendations(orgSlug: string, limit = 8, segmentId?: string | null): Promise<OrgRec[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId) },
    select: {
      name: true,
      scans: {
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: { recommendations: { where: { status: { in: ["open", "in_progress"] } }, select: { title: true, dimId: true, impact: true } } },
      },
    },
  });

  const w = weightsFor("org");
  const groups = new Map<string, { title: string; dimId: string; impact: string; repos: Set<string> }>();
  for (const r of repos) {
    const recs = r.scans[0]?.recommendations ?? [];
    for (const rec of recs) {
      const key = `${rec.dimId}::${rec.title}`;
      const g = groups.get(key) ?? { title: rec.title, dimId: rec.dimId, impact: rec.impact, repos: new Set<string>() };
      g.repos.add(r.name);
      // keep the strongest impact seen for this rec
      if ((IMPACT_WEIGHT[rec.impact] ?? 0) > (IMPACT_WEIGHT[g.impact] ?? 0)) g.impact = rec.impact;
      groups.set(key, g);
    }
  }

  const recs: OrgRec[] = [...groups.values()].map((g) => {
    const repoCount = g.repos.size;
    const dimW = w[g.dimId as DimensionId] ?? 0.1;
    return {
      title: g.title,
      dimId: g.dimId,
      impact: g.impact,
      repoCount,
      repos: [...g.repos].sort(),
      leverage: Math.round(repoCount * (IMPACT_WEIGHT[g.impact] ?? 1) * (1 + dimW) * 10) / 10,
    };
  });
  recs.sort((a, b) => b.leverage - a.leverage || b.repoCount - a.repoCount);
  return recs.slice(0, limit);
}

// ── Recommendation backlog — owners, due dates, and a trackable roadmap ─────────
// Where getOrgRecommendations DEDUPES identical gaps across repos into systemic moves, the backlog
// lists the concrete per-repo recommendation rows that carry an OWNER and a DUE DATE — the unit a
// leader actually assigns and tracks. It reads the latest scan per repo (status, assignee, and due
// date carry forward across re-scans) and groups the actionable items (open + in_progress) two ways:
// by owner (who is accountable) and by due-date bucket (what is overdue / due soon). Done and
// dismissed items are summarized in the counts but kept out of the active lists.

export type BacklogDueBucket = "overdue" | "this_week" | "this_month" | "later" | "no_date";

const DUE_BUCKET_LABEL: Record<BacklogDueBucket, string> = {
  overdue: "Overdue",
  this_week: "Due this week",
  this_month: "Due this month",
  later: "Later",
  no_date: "No due date",
};

/** Fixed display order for the due-date columns (most urgent first; undated last). */
const DUE_BUCKET_ORDER: BacklogDueBucket[] = ["overdue", "this_week", "this_month", "later", "no_date"];

/** Whole calendar days from `now` to `target` (UTC date-only), negative when `target` is past. */
function daysUntil(target: Date, now: Date): number {
  const t = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const n = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((t - n) / 86_400_000);
}

/**
 * Which due-date bucket a target date falls into, relative to `now`. Pure (no clock read) so the
 * bucketing is unit-testable: null → no_date; past → overdue; within 7 days → this_week; within ~a
 * month → this_month; beyond → later.
 */
export function dueBucketFor(targetDate: Date | null, now: Date): BacklogDueBucket {
  if (!targetDate) return "no_date";
  const d = daysUntil(targetDate, now);
  if (d < 0) return "overdue";
  if (d <= 7) return "this_week";
  if (d <= 31) return "this_month";
  return "later";
}

/** One assignable recommendation in the backlog — a concrete per-repo row with owner + due date. */
export interface BacklogItem {
  id: string;
  title: string;
  dimId: string;
  dimLabel: string;
  impact: string;
  effort: string;
  status: string;
  assigneeLogin: string | null;
  targetDate: string | null; // ISO date (YYYY-MM-DD), or null
  dueBucket: BacklogDueBucket;
  /** Whole days until due (negative = overdue); null when undated. */
  dueInDays: number | null;
  overdue: boolean;
  repo: string; // owner/name
  repoName: string;
  /** Most recent activity (latest event) or the row's creation time, ISO. */
  lastActivityAt: string;
}

/** Status tallies shared by the overall summary and each owner group. */
interface BacklogCounts {
  open: number;
  inProgress: number;
  done: number;
  dismissed: number;
  overdue: number;
}

export interface BacklogOwnerGroup extends BacklogCounts {
  login: string | null; // null = the Unassigned bucket
  /** Count of active (open + in_progress) items — the size of this owner's working backlog. */
  active: number;
  items: BacklogItem[];
}

export interface BacklogDueGroup {
  bucket: BacklogDueBucket;
  label: string;
  items: BacklogItem[];
}

export interface OrgBacklog extends BacklogCounts {
  org: string;
  /** Scanned repos contributing recommendations. */
  repos: number;
  /** Total recommendations across the fleet's latest scans (all statuses). */
  tracked: number;
  /** Active items shown in the grouped lists (open + in_progress). */
  active: number;
  assigned: number; // active items with an owner
  unassigned: number; // active items without one
  dueSoon: number; // active items due within 7 days (not already overdue)
  byOwner: BacklogOwnerGroup[]; // most overdue, then largest working backlog; Unassigned last
  byDue: BacklogDueGroup[]; // fixed bucket order
  /** Distinct human contributor logins across the fleet — options for the assignee picker. */
  assignees: string[];
}

/**
 * The org-wide recommendation backlog: every actionable gap from the fleet's latest scans, with its
 * owner and due date, grouped by owner and by due-date bucket. This is the planning surface the
 * status/assignee/due-date layer feeds — see updateRecommendation + getRecommendationEvents for the
 * per-item history. Segment-aware (scopes to a tagged slice when `segmentId` is given). Returns null
 * when persistence is off or the org doesn't exist.
 */
export async function getOrgBacklog(orgSlug: string, segmentId?: string | null, now: Date = new Date()): Promise<OrgBacklog | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId) },
    select: {
      fullName: true,
      name: true,
      scans: {
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: {
          recommendations: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              title: true,
              dimId: true,
              impact: true,
              effort: true,
              status: true,
              assigneeLogin: true,
              targetDate: true,
              createdAt: true,
              events: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
            },
          },
        },
      },
    },
  });

  // Distinct human logins across the fleet's contributor snapshots — the assignee picker options.
  const contributorRows = await prisma.repoContributor.findMany({
    where: { repo: { orgId: org.id, ...segmentScope(segmentId) } },
    select: { login: true },
    distinct: ["login"],
  });
  const assignees = contributorRows
    .map((c) => c.login)
    .filter((l) => !isBot(l))
    .sort((a, b) => a.localeCompare(b));

  const ACTIVE = new Set(["open", "in_progress"]);
  const items: BacklogItem[] = [];
  const counts: BacklogCounts = { open: 0, inProgress: 0, done: 0, dismissed: 0, overdue: 0 };
  let tracked = 0;
  let contributingRepos = 0;

  for (const repo of repos) {
    const recs = repo.scans[0]?.recommendations ?? [];
    if (recs.length > 0) contributingRepos += 1;
    for (const r of recs) {
      tracked += 1;
      if (r.status === "open") counts.open += 1;
      else if (r.status === "in_progress") counts.inProgress += 1;
      else if (r.status === "done") counts.done += 1;
      else if (r.status === "dismissed") counts.dismissed += 1;

      // Only open / in_progress items make up the working backlog the views group and surface.
      if (!ACTIVE.has(r.status)) continue;

      const dueInDays = r.targetDate ? daysUntil(r.targetDate, now) : null;
      const overdue = dueInDays != null && dueInDays < 0;
      if (overdue) counts.overdue += 1;
      items.push({
        id: r.id,
        title: r.title,
        dimId: r.dimId,
        dimLabel: DIMENSION_BY_ID[r.dimId as DimensionId]?.name ?? r.dimId,
        impact: r.impact,
        effort: r.effort,
        status: r.status,
        assigneeLogin: r.assigneeLogin,
        targetDate: r.targetDate ? r.targetDate.toISOString().slice(0, 10) : null,
        dueBucket: dueBucketFor(r.targetDate, now),
        dueInDays,
        overdue,
        repo: repo.fullName,
        repoName: repo.name,
        lastActivityAt: (r.events[0]?.createdAt ?? r.createdAt).toISOString(),
      });
    }
  }

  // Within a group, surface the most pressing work first: soonest due (undated last), then highest
  // impact, then most recently touched.
  const impactRank = (i: string) => IMPACT_WEIGHT[i] ?? 0;
  const sortItems = (a: BacklogItem, b: BacklogItem) => {
    const ad = a.dueInDays ?? Number.POSITIVE_INFINITY;
    const bd = b.dueInDays ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    if (impactRank(b.impact) !== impactRank(a.impact)) return impactRank(b.impact) - impactRank(a.impact);
    return b.lastActivityAt.localeCompare(a.lastActivityAt);
  };
  items.sort(sortItems);

  // Group by owner (null = Unassigned).
  const ownerMap = new Map<string | null, BacklogOwnerGroup>();
  for (const it of items) {
    const key = it.assigneeLogin;
    const g =
      ownerMap.get(key) ??
      { login: key, active: 0, open: 0, inProgress: 0, done: 0, dismissed: 0, overdue: 0, items: [] as BacklogItem[] };
    g.items.push(it);
    g.active += 1;
    if (it.status === "open") g.open += 1;
    else if (it.status === "in_progress") g.inProgress += 1;
    if (it.overdue) g.overdue += 1;
    ownerMap.set(key, g);
  }
  const byOwner = [...ownerMap.values()].sort((a, b) => {
    // Unassigned always sits last so it reads as the "needs an owner" pile, not a person.
    if ((a.login === null) !== (b.login === null)) return a.login === null ? 1 : -1;
    if (a.overdue !== b.overdue) return b.overdue - a.overdue;
    if (a.active !== b.active) return b.active - a.active;
    return (a.login ?? "").localeCompare(b.login ?? "");
  });

  // Group by due-date bucket, in fixed urgency order (empty buckets omitted).
  const dueMap = new Map<BacklogDueBucket, BacklogItem[]>();
  for (const it of items) {
    const arr = dueMap.get(it.dueBucket) ?? [];
    arr.push(it);
    dueMap.set(it.dueBucket, arr);
  }
  const byDue: BacklogDueGroup[] = DUE_BUCKET_ORDER.filter((b) => dueMap.has(b)).map((bucket) => ({
    bucket,
    label: DUE_BUCKET_LABEL[bucket],
    items: dueMap.get(bucket)!,
  }));

  const assigned = items.filter((i) => i.assigneeLogin).length;
  const dueSoon = items.filter((i) => i.dueInDays != null && i.dueInDays >= 0 && i.dueInDays <= 7).length;

  return {
    org: orgSlug,
    repos: contributingRepos,
    tracked,
    active: items.length,
    open: counts.open,
    inProgress: counts.inProgress,
    done: counts.done,
    dismissed: counts.dismissed,
    overdue: counts.overdue,
    assigned,
    unassigned: items.length - assigned,
    dueSoon,
    byOwner,
    byDue,
    assignees,
  };
}

// ── F6: benchmark vs the Ascent corpus ────────────────────────────────────────

export interface OrgBenchmark {
  corpusRepos: number; // repos in the comparison corpus (other orgs)
  overallPercentile: number | null; // org avg overall vs corpus (null if no corpus)
  corpusAvgOverall: number;
  corpusAvgAdoption: number;
  corpusAvgRigor: number;
}

/** Compare an org's averages against every other repo Ascent has scored (the corpus). */
export async function getOrgBenchmark(orgSlug: string): Promise<OrgBenchmark | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  // Latest scan per repo, for every repo NOT in this org.
  const repos = await prisma.repository.findMany({
    where: { orgId: { not: org.id } },
    select: { scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { overallScore: true, adoptionScore: true, rigorScore: true } } },
  });
  const corpus = repos.map((r) => r.scans[0]).filter((s): s is NonNullable<typeof s> => !!s);
  if (corpus.length === 0) return { corpusRepos: 0, overallPercentile: null, corpusAvgOverall: 0, corpusAvgAdoption: 0, corpusAvgRigor: 0 };

  // This org's average overall (latest scan per repo).
  const mine = await prisma.repository.findMany({
    where: { orgId: org.id },
    select: { scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { overallScore: true } } },
  });
  const myScores = mine.map((r) => r.scans[0]?.overallScore).filter((x): x is number => x != null);
  const myAvg = myScores.length ? myScores.reduce((a, b) => a + b, 0) / myScores.length : 0;

  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const below = corpus.filter((s) => s.overallScore <= myAvg).length;
  return {
    corpusRepos: corpus.length,
    overallPercentile: Math.round((below / corpus.length) * 100),
    corpusAvgOverall: avg(corpus.map((s) => s.overallScore)),
    corpusAvgAdoption: avg(corpus.map((s) => s.adoptionScore)),
    corpusAvgRigor: avg(corpus.map((s) => s.rigorScore)),
  };
}

// ── P2: Practice Library — capture & reuse best practices across the org ──────

export interface OrgPractice {
  id: string;
  label: string;
  dimId: string;
  what: string;
  starter: string[];
  total: number; // repos scored on this dimension
  strongCount: number; // repos that embody the practice (score ≥ 70)
  exemplar: { name: string; fullName: string; score: number } | null; // learn from this one
  gapRepos: string[]; // repos that could adopt it (score < 40) — display names
  gapRepoRefs: { name: string; fullName: string }[]; // same repos with fullName, for "apply" actions
}

const STRONG = 70;
const GAP = 40;

/** The org's playbook: for each practice, who exemplifies it and who could adopt it next. */
export async function getOrgPractices(orgSlug: string): Promise<OrgPractice[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id },
    select: {
      name: true,
      fullName: true,
      scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { dimensions: { select: { dimId: true, score: true } } } },
    },
  });

  // Per-dimension list of {repo, score} from each repo's latest scan.
  const byDim = new Map<string, { name: string; fullName: string; score: number }[]>();
  for (const r of repos) {
    const dims = r.scans[0]?.dimensions;
    if (!dims) continue;
    for (const d of dims) {
      const arr = byDim.get(d.dimId) ?? [];
      arr.push({ name: r.name, fullName: r.fullName, score: d.score });
      byDim.set(d.dimId, arr);
    }
  }
  if (byDim.size === 0) return null;

  const practices: OrgPractice[] = PRACTICES.map((p) => {
    const rows = (byDim.get(p.dimId) ?? []).slice().sort((a, b) => b.score - a.score);
    const top = rows[0];
    return {
      id: p.id,
      label: p.label,
      dimId: p.dimId,
      what: p.what,
      starter: p.starter,
      total: rows.length,
      strongCount: rows.filter((r) => r.score >= STRONG).length,
      exemplar: top && top.score >= STRONG ? { name: top.name, fullName: top.fullName, score: top.score } : null,
      gapRepos: rows.filter((r) => r.score < GAP).map((r) => r.name),
      gapRepoRefs: rows.filter((r) => r.score < GAP).map((r) => ({ name: r.name, fullName: r.fullName })),
    };
  });

  // Biggest reuse opportunity first: practices with an exemplar to copy AND many repos lacking it.
  return practices.sort((a, b) => {
    const aOpp = (a.exemplar ? 1 : 0) * a.gapRepos.length;
    const bOpp = (b.exemplar ? 1 : 0) * b.gapRepos.length;
    return bOpp - aOpp || b.gapRepos.length - a.gapRepos.length;
  });
}

// ── Cross-repo gap analysis — common org gaps vs repo-specific ────────────────

export interface CommonGap {
  dimId: string;
  label: string;
  weakCount: number; // repos weak on this dimension
  total: number;
  avg: number; // org average for the dimension
  practiceId: string | null; // link into the Practice Library
  exemplar: { name: string; fullName: string; score: number } | null; // who already nails it
}

export interface RepoOutlier {
  fullName: string;
  name: string;
  dimId: string;
  label: string;
  score: number;
  orgAvg: number;
  delta: number; // how far below the org this repo sits
}

export interface OrgGapAnalysis {
  scanned: number;
  commonGaps: CommonGap[]; // systemic — fix once, apply across the fleet
  repoSpecific: RepoOutlier[]; // outliers — a repo lags what the rest of the org has handled
}

const GAP_SCORE = 45; // a repo is "weak" on a dimension below this
const COMMON_RATIO = 0.5; // weak in ≥ half the repos → a common org gap
const OUTLIER_DELTA = 18; // repo lags the org average by this much → repo-specific
const HEALTHY_AVG = 50; // …while the org generally handles that dimension

/**
 * Separate **common organization gaps** (weak across most repos — fix once, systematically) from
 * **repo-specific gaps** (a repo lagging what the rest of the org already handles). The headline
 * cross-repo insight: is this an org problem or a repo problem?
 */
export async function getOrgGapAnalysis(orgSlug: string, segmentId?: string | null): Promise<OrgGapAnalysis | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId) },
    select: {
      name: true,
      fullName: true,
      scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { dimensions: { select: { dimId: true, score: true } } } },
    },
  });

  // Per dimension: [{repo, score}]. Per repo: its dim→score map.
  const byDim = new Map<string, { name: string; fullName: string; score: number }[]>();
  const perRepo: { name: string; fullName: string; dims: Record<string, number> }[] = [];
  for (const r of repos) {
    const dims = r.scans[0]?.dimensions;
    if (!dims?.length) continue;
    const map: Record<string, number> = {};
    for (const d of dims) {
      map[d.dimId] = d.score;
      const arr = byDim.get(d.dimId) ?? [];
      arr.push({ name: r.name, fullName: r.fullName, score: d.score });
      byDim.set(d.dimId, arr);
    }
    perRepo.push({ name: r.name, fullName: r.fullName, dims: map });
  }
  const scanned = perRepo.length;
  if (scanned === 0) return null;

  const dimAvg: Record<string, number> = {};
  const commonGaps: CommonGap[] = [];
  for (const [dimId, rows] of byDim) {
    const avg = Math.round(rows.reduce((a, b) => a + b.score, 0) / rows.length);
    dimAvg[dimId] = avg;
    const weakCount = rows.filter((r) => r.score < GAP_SCORE).length;
    if (weakCount / rows.length >= COMMON_RATIO) {
      const top = [...rows].sort((a, b) => b.score - a.score)[0];
      commonGaps.push({
        dimId,
        label: DIMENSION_BY_ID[dimId as DimensionId]?.name ?? dimId,
        weakCount,
        total: rows.length,
        avg,
        practiceId: PRACTICES.find((p) => p.dimId === dimId)?.id ?? null,
        exemplar: top && top.score >= 70 ? { name: top.name, fullName: top.fullName, score: top.score } : null,
      });
    }
  }
  commonGaps.sort((a, b) => b.weakCount - a.weakCount || a.avg - b.avg);

  // Repo-specific: a repo well below the org average on a dimension the org generally handles.
  const repoSpecific: RepoOutlier[] = [];
  for (const r of perRepo) {
    for (const [dimId, score] of Object.entries(r.dims)) {
      const orgAvg = dimAvg[dimId] ?? 0;
      const delta = orgAvg - score;
      if (orgAvg >= HEALTHY_AVG && delta >= OUTLIER_DELTA) {
        repoSpecific.push({
          fullName: r.fullName,
          name: r.name,
          dimId,
          label: DIMENSION_BY_ID[dimId as DimensionId]?.name ?? dimId,
          score,
          orgAvg,
          delta,
        });
      }
    }
  }
  repoSpecific.sort((a, b) => b.delta - a.delta);

  return { scanned, commonGaps, repoSpecific: repoSpecific.slice(0, 12) };
}

// ── Deepen-F3: governance + activity aggregates ───────────────────────────────

export interface RepoGovernance {
  fullName: string;
  name: string;
  protected: boolean;
  requiresPullRequest: boolean;
  requiredApprovals: number;
  requiresStatusChecks: boolean;
  requiresSignatures: boolean;
  ruleCount: number;
}

export interface OrgGovernance {
  repos: number; // repos with readable governance
  protectedRate: number;
  requireReviewRate: number;
  requireChecksRate: number;
  signedRate: number;
  perRepo: RepoGovernance[]; // sorted: least-protected first (risk surfaced)
}

/** Fleet default-branch governance — from each repo's latest scan's `governance` JSON. */
export async function getOrgGovernance(orgSlug: string): Promise<OrgGovernance | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id },
    select: { fullName: true, name: true, scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { governance: true } } },
  });

  const perRepo: RepoGovernance[] = [];
  for (const r of repos) {
    const raw = r.scans[0]?.governance;
    if (!raw) continue;
    try {
      const g = JSON.parse(raw) as {
        protected: boolean;
        requiresPullRequest: boolean;
        requiredApprovals: number;
        requiresStatusChecks: boolean;
        requiresSignatures: boolean;
        ruleCount: number;
        readable: boolean;
      };
      if (!g.readable) continue;
      perRepo.push({
        fullName: r.fullName,
        name: r.name,
        protected: g.protected,
        requiresPullRequest: g.requiresPullRequest,
        requiredApprovals: g.requiredApprovals,
        requiresStatusChecks: g.requiresStatusChecks,
        requiresSignatures: g.requiresSignatures,
        ruleCount: g.ruleCount,
      });
    } catch {
      /* ignore */
    }
  }
  if (!perRepo.length) return null;

  const rate = (pred: (g: RepoGovernance) => boolean) => Math.round((perRepo.filter(pred).length / perRepo.length) * 100);
  // Risk-first: unprotected repos, then fewest rules.
  perRepo.sort((a, b) => Number(a.protected) - Number(b.protected) || a.ruleCount - b.ruleCount);
  return {
    repos: perRepo.length,
    protectedRate: rate((g) => g.protected),
    requireReviewRate: rate((g) => g.requiresPullRequest),
    requireChecksRate: rate((g) => g.requiresStatusChecks),
    signedRate: rate((g) => g.requiresSignatures),
    perRepo,
  };
}

export interface OrgActivity {
  weeks: number;
  series: number[]; // fleet weekly commit totals (sum across repos), oldest→newest
  total: number;
  repos: number;
}

/** Fleet commit-activity trend — element-wise sum of each repo's latest weekly series. */
export async function getOrgActivity(orgSlug: string): Promise<OrgActivity | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id },
    select: { scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { commitActivity: true } } },
  });

  const seriesList: number[][] = [];
  for (const r of repos) {
    const raw = r.scans[0]?.commitActivity;
    if (!raw) continue;
    try {
      const arr = JSON.parse(raw) as number[];
      if (Array.isArray(arr) && arr.length) seriesList.push(arr);
    } catch {
      /* ignore */
    }
  }
  if (!seriesList.length) return null;

  // Align by most-recent week (last element) and sum.
  const maxLen = Math.max(...seriesList.map((s) => s.length));
  const series = new Array(maxLen).fill(0);
  for (const s of seriesList) {
    const offset = maxLen - s.length;
    for (let i = 0; i < s.length; i++) series[offset + i] += s[i];
  }
  return { weeks: maxLen, series, total: series.reduce((a, b) => a + b, 0), repos: seriesList.length };
}

// ── Calibration: LLM-as-auditor detector backlog ──────────────────────────────
// The scan's LLM auditor flags signals it believes the deterministic detectors got wrong
// (`Scan.discrepancies`). Aggregated across the fleet, recurring claims for one dimension are a
// prioritized backlog of detector improvements — the loop that keeps the core IP calibrated.

export interface DiscrepancyGroup {
  dimId: string;
  label: string;
  count: number; // total times flagged across the fleet
  repos: string[]; // repos where this dimension was flagged
  examples: string[]; // distinct sample claims (capped)
}

export interface OrgDiscrepancies {
  scanned: number; // repos with a latest scan
  flaggedRepos: number; // repos with ≥1 auditor flag
  total: number; // total flags
  groups: DiscrepancyGroup[]; // by dimension, most-flagged first
}

/** Aggregate the LLM auditor's suspected detector misses across the fleet → a detector backlog. */
export async function getOrgDiscrepancies(orgSlug: string): Promise<OrgDiscrepancies | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id },
    select: { name: true, scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { discrepancies: true } } },
  });

  const groups = new Map<string, { count: number; repos: Set<string>; examples: Set<string> }>();
  let scanned = 0;
  let total = 0;
  const flagged = new Set<string>();

  for (const r of repos) {
    const raw = r.scans[0]?.discrepancies;
    if (raw == null) continue;
    scanned += 1;
    let parsed: { dimension?: unknown; claim?: unknown }[] = [];
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) parsed = p;
    } catch {
      continue;
    }
    for (const d of parsed) {
      if (typeof d.dimension !== "string" || typeof d.claim !== "string") continue;
      const g = groups.get(d.dimension) ?? { count: 0, repos: new Set<string>(), examples: new Set<string>() };
      g.count += 1;
      g.repos.add(r.name);
      if (g.examples.size < 4) g.examples.add(d.claim.trim());
      groups.set(d.dimension, g);
      total += 1;
      flagged.add(r.name);
    }
  }
  if (scanned === 0) return null;

  const out: DiscrepancyGroup[] = [...groups.entries()]
    .map(([dimId, g]) => ({
      dimId,
      label: DIMENSION_BY_ID[dimId as DimensionId]?.name ?? dimId,
      count: g.count,
      repos: [...g.repos].sort(),
      examples: [...g.examples],
    }))
    .sort((a, b) => b.count - a.count || b.repos.length - a.repos.length);

  return { scanned, flaggedRepos: flagged.size, total, groups: out };
}

/** Fleet-level pull-request signals — aggregated from each repo's latest scan's prStats. */
export async function getOrgPrSignals(orgSlug: string): Promise<OrgPrSignals | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id },
    select: { scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { prStats: true } } },
  });

  const stats: PrStats[] = [];
  for (const r of repos) {
    const raw = r.scans[0]?.prStats;
    if (!raw) continue;
    try {
      const p = JSON.parse(raw) as PrStats;
      if (p.analyzed > 0) stats.push(p);
    } catch {
      /* ignore malformed */
    }
  }
  if (!stats.length) return null;

  const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const ttm = stats.map((s) => s.medianHoursToMerge).filter((x): x is number => x != null);
  const governed = stats.map((s) => s.aiGovernedRate).filter((x): x is number => x != null);
  const toolMap = new Map<string, number>();
  for (const s of stats) for (const t of s.tools) toolMap.set(t.name, (toolMap.get(t.name) ?? 0) + t.count);

  return {
    repos: stats.length,
    totalPrs: stats.reduce((a, s) => a + s.analyzed, 0),
    avgMergeRate: mean(stats.map((s) => s.mergeRate)),
    avgReviewedRate: mean(stats.map((s) => s.reviewedRate)),
    avgSmallPrRate: mean(stats.map((s) => s.smallPrRate)),
    avgAiInvolvedRate: mean(stats.map((s) => s.aiInvolvedRate)),
    avgAiGovernedRate: governed.length ? mean(governed) : null,
    typicalHoursToMerge: ttm.length ? Math.round((ttm.reduce((a, b) => a + b, 0) / ttm.length) * 10) / 10 : null,
    tools: [...toolMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

// ── C6: Team & CODEOWNERS rollups across the fleet ─────────────────────────────
// Every rollup above aggregates by repo or by individual contributor; this one aggregates by TEAM,
// using the CODEOWNERS attribution captured at scan time (RepoTeam). A repo is attributed to every
// team that owns part of it, so each team's Adoption×Rigor, dimension gaps, movers, and AI-knowledge
// roll up across the repos it's responsible for — mapping a repo-centric dashboard onto how the org
// is actually structured. Inputs, not rankings: the headline surfaces which team carries the most
// institutional AI knowledge and one concrete pairing to spread it, never a leaderboard.

const TEAM_STRONG = 65; // a team "exemplifies" a dimension at/above this (a mentor candidate)
const TEAM_WEAK = 50; // a team could grow a dimension below this (a learner candidate)

export interface TeamDimAvg {
  dimId: string;
  label: string;
  avg: number;
}

export interface TeamRepoScore {
  fullName: string;
  name: string;
  overall: number;
  adoption: number;
  rigor: number;
  level: string;
  posture: string;
  isDefaultOwner: boolean; // this team owns the repo's "*" catch-all (its primary owner)
}

export interface TeamChampion {
  login: string;
  name: string | null;
  aiCommits: number;
  aiShare: number; // 0..100 of this person's commits that are AI-attributed
}

export interface TeamRollup {
  slug: string; // "@org/team"
  name: string; // display: the segment after the last "/"
  repoCount: number; // owned repos that have a scan (drive the averages)
  totalOwned: number; // owned repos total, incl. not-yet-scanned
  defaultOwnerCount: number; // owned repos where this team is the primary ("*") owner
  repos: TeamRepoScore[]; // owned + scanned repos, strongest overall first
  avgOverall: number;
  avgAdoption: number;
  avgRigor: number;
  posture: string; // posture id from the team's avg adoption/rigor
  dimAverages: TeamDimAvg[]; // by dimId
  strongest: TeamDimAvg | null; // the team's best dimension — what others could learn from it
  weakest: TeamDimAvg | null; // the team's softest dimension — where it could grow
  // Institutional AI knowledge — from the team's repos' contributor snapshots (humans only).
  contributors: number;
  aiContributors: number; // humans with ≥1 AI-attributed commit
  aiCommitShare: number; // 0..100, commit-weighted across the team's repos
  champions: TeamChampion[]; // top humans by AI commits — the culture carriers
  knowledgeScore: number; // 0..100 blend of aiCommitShare + avgAdoption ("most AI knowledge")
  // Movers ("since last scan"): per-repo latest-vs-previous overall delta, aggregated.
  comparedRepos: number;
  improving: number;
  declining: number;
  avgDelta: number; // mean overall delta across comparedRepos
}

/** A suggested cross-team pairing: a team strong on a dimension next to one weak on the same one. */
export interface TeamPairing {
  mentorSlug: string;
  mentorName: string;
  learnerSlug: string;
  learnerName: string;
  dimId: string;
  label: string;
  mentorScore: number;
  learnerScore: number;
  gap: number;
}

export interface OrgTeamRollup {
  org: string;
  source: "codeowners";
  teamCount: number;
  attributedRepos: number; // scanned repos with ≥1 CODEOWNERS team
  unownedRepos: number; // scanned repos with no CODEOWNERS team
  teams: TeamRollup[]; // sorted: most repos first, then maturity
  /** The team whose recent work is most AI-attributed and whose repos are most AI-native — an input
   *  for "who could mentor", never a ranking. Null when no team shows AI activity. */
  knowledgeLeader: {
    slug: string;
    name: string;
    aiCommitShare: number;
    avgAdoption: number;
    knowledgeScore: number;
  } | null;
  /** The single highest-leverage cross-team pairing. An invitation to pair, not a directive. Null
   *  when no clear strong→weak gap exists on any shared dimension. */
  pairing: TeamPairing | null;
}

/** The per-repo data the team rollup aggregates over (one row per repo; scans most-recent first). */
export interface TeamRollupRepoInput {
  fullName: string;
  name: string;
  teams: { slug: string; ownedPaths: number; isDefaultOwner: boolean }[];
  scans: {
    overallScore: number;
    adoptionScore: number;
    rigorScore: number;
    level: string;
    posture: string;
    dimensions: { dimId: string; score: number }[];
  }[];
  contributors: { login: string; name: string | null; commits: number; aiCommits: number }[];
}

interface TeamAcc {
  slug: string;
  repos: TeamRepoScore[];
  totalOwned: number;
  defaultOwnerCount: number;
  dim: Map<string, { sum: number; n: number }>;
  deltas: number[];
  people: Map<string, { login: string; name: string | null; commits: number; aiCommits: number }>;
}

/**
 * Pure aggregation behind getOrgTeamRollup — exported for unit testing (no DB). Buckets each repo
 * into every team that owns it (from CODEOWNERS), then rolls each team up: maturity averages,
 * per-dimension averages (strongest/weakest), merged human contributor AI-knowledge, and
 * since-last-scan movers. Finally derives the org-level knowledge leader and one suggested pairing.
 */
export function rollupTeams(orgSlug: string, repos: TeamRollupRepoInput[]): OrgTeamRollup {
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

  const acc = new Map<string, TeamAcc>();
  let attributedRepos = 0;
  let unownedRepos = 0;

  for (const r of repos) {
    const latest = r.scans[0];
    const prev = r.scans[1];
    const hasTeams = r.teams.length > 0;
    if (latest) {
      if (hasTeams) attributedRepos += 1;
      else unownedRepos += 1;
    }
    if (!hasTeams) continue; // unowned repos belong to no team

    for (const t of r.teams) {
      const a: TeamAcc =
        acc.get(t.slug) ??
        { slug: t.slug, repos: [], totalOwned: 0, defaultOwnerCount: 0, dim: new Map(), deltas: [], people: new Map() };
      a.totalOwned += 1;
      if (t.isDefaultOwner) a.defaultOwnerCount += 1;

      if (latest) {
        a.repos.push({
          fullName: r.fullName,
          name: r.name,
          overall: latest.overallScore,
          adoption: latest.adoptionScore,
          rigor: latest.rigorScore,
          level: latest.level,
          posture: latest.posture,
          isDefaultOwner: t.isDefaultOwner,
        });
        for (const d of latest.dimensions) {
          const e = a.dim.get(d.dimId) ?? { sum: 0, n: 0 };
          e.sum += d.score;
          e.n += 1;
          a.dim.set(d.dimId, e);
        }
        if (prev) a.deltas.push(latest.overallScore - prev.overallScore);
        // Merge the repo's contributors into the team (humans only; a person across N of the team's
        // repos is one team member with summed commits).
        for (const c of r.contributors) {
          if (isBot(c.login)) continue;
          const p = a.people.get(c.login) ?? { login: c.login, name: c.name, commits: 0, aiCommits: 0 };
          p.commits += c.commits;
          p.aiCommits += c.aiCommits;
          if (!p.name && c.name) p.name = c.name;
          a.people.set(c.login, p);
        }
      }
      acc.set(t.slug, a);
    }
  }

  const teams: TeamRollup[] = [...acc.values()]
    .map((a) => {
      const teamRepos = [...a.repos].sort((x, y) => y.overall - x.overall);
      const avgOverall = avg(teamRepos.map((r) => r.overall));
      const avgAdoption = avg(teamRepos.map((r) => r.adoption));
      const avgRigor = avg(teamRepos.map((r) => r.rigor));
      const dimAverages: TeamDimAvg[] = [...a.dim.entries()]
        .map(([dimId, { sum, n }]) => ({
          dimId,
          label: DIMENSION_BY_ID[dimId as DimensionId]?.name ?? dimId,
          avg: Math.round(sum / n),
        }))
        .sort((x, y) => x.dimId.localeCompare(y.dimId));
      const byScore = [...dimAverages].sort((x, y) => y.avg - x.avg);

      const people = [...a.people.values()];
      const totCommits = people.reduce((s, p) => s + p.commits, 0);
      const totAi = people.reduce((s, p) => s + p.aiCommits, 0);
      const aiContributors = people.filter((p) => p.aiCommits > 0).length;
      const aiCommitShare = totCommits ? Math.round((totAi / totCommits) * 100) : 0;
      const champions: TeamChampion[] = people
        .filter((p) => p.aiCommits > 0)
        .sort((x, y) => y.aiCommits - x.aiCommits)
        .slice(0, 3)
        .map((p) => ({
          login: p.login,
          name: p.name,
          aiCommits: p.aiCommits,
          aiShare: p.commits ? Math.round((p.aiCommits / p.commits) * 100) : 0,
        }));
      // Blend "how much of the team's recent work is AI-attributed" with "how AI-native its repos'
      // tooling is" — two equal, explainable inputs, not an opaque score.
      const knowledgeScore = Math.round(aiCommitShare * 0.5 + avgAdoption * 0.5);

      return {
        slug: a.slug,
        name: teamDisplayName(a.slug),
        repoCount: teamRepos.length,
        totalOwned: a.totalOwned,
        defaultOwnerCount: a.defaultOwnerCount,
        repos: teamRepos,
        avgOverall,
        avgAdoption,
        avgRigor,
        posture: postureFor(avgAdoption, avgRigor).id,
        dimAverages,
        strongest: byScore[0] ?? null,
        weakest: byScore[byScore.length - 1] ?? null,
        contributors: people.length,
        aiContributors,
        aiCommitShare,
        champions,
        knowledgeScore,
        comparedRepos: a.deltas.length,
        improving: a.deltas.filter((d) => d > 0).length,
        declining: a.deltas.filter((d) => d < 0).length,
        avgDelta: a.deltas.length ? Math.round(a.deltas.reduce((s, d) => s + d, 0) / a.deltas.length) : 0,
      };
    })
    .filter((t) => t.repoCount > 0) // only teams with a scored repo carry meaningful metrics
    .sort((a, b) => b.repoCount - a.repoCount || b.avgOverall - a.avgOverall || a.slug.localeCompare(b.slug));

  // Knowledge leader: the team carrying the most institutional AI knowledge. Requires real AI
  // activity so an all-manual fleet surfaces none (no false "leader").
  const knowledgeLeader =
    [...teams]
      .filter((t) => t.aiContributors > 0)
      .sort((a, b) => b.knowledgeScore - a.knowledgeScore || b.aiCommitShare - a.aiCommitShare)[0] ?? null;

  // Pairing: the biggest learnable gap on a single shared dimension — a strong team next to a weak
  // one. Surfaces "who to pair next" as an invitation, scanning every dimension any team is scored on.
  let pairing: TeamPairing | null = null;
  if (teams.length >= 2) {
    const allDims = new Set<string>();
    for (const t of teams) for (const d of t.dimAverages) allDims.add(d.dimId);
    let best: TeamPairing | null = null;
    for (const dimId of allDims) {
      const scored = teams
        .map((t) => ({ t, d: t.dimAverages.find((x) => x.dimId === dimId) }))
        .filter((x): x is { t: TeamRollup; d: TeamDimAvg } => !!x.d);
      if (scored.length < 2) continue;
      const sorted = [...scored].sort((a, b) => b.d.avg - a.d.avg);
      const mentor = sorted[0];
      const learner = sorted[sorted.length - 1];
      if (mentor.t.slug === learner.t.slug) continue;
      if (mentor.d.avg < TEAM_STRONG || learner.d.avg >= TEAM_WEAK) continue; // need a real strong→weak gap
      const gap = mentor.d.avg - learner.d.avg;
      if (!best || gap > best.gap) {
        best = {
          mentorSlug: mentor.t.slug,
          mentorName: mentor.t.name,
          learnerSlug: learner.t.slug,
          learnerName: learner.t.name,
          dimId,
          label: mentor.d.label,
          mentorScore: mentor.d.avg,
          learnerScore: learner.d.avg,
          gap,
        };
      }
    }
    pairing = best;
  }

  return {
    org: orgSlug,
    source: "codeowners",
    teamCount: teams.length,
    attributedRepos,
    unownedRepos,
    teams,
    knowledgeLeader: knowledgeLeader
      ? {
          slug: knowledgeLeader.slug,
          name: knowledgeLeader.name,
          aiCommitShare: knowledgeLeader.aiCommitShare,
          avgAdoption: knowledgeLeader.avgAdoption,
          knowledgeScore: knowledgeLeader.knowledgeScore,
        }
      : null,
    pairing,
  };
}

/**
 * Team-level rollup across the org's fleet, keyed by CODEOWNERS team attribution. Pulls each repo's
 * teams, its latest two scans (for since-last-scan movers), and its contributor snapshots in one
 * query, then aggregates per team via rollupTeams. Null when persistence is off or the org is
 * unknown; an org with no CODEOWNERS teams returns a populated shape with `teams: []`.
 */
export async function getOrgTeamRollup(orgSlug: string): Promise<OrgTeamRollup | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id },
    select: {
      fullName: true,
      name: true,
      teams: { select: { slug: true, ownedPaths: true, isDefaultOwner: true } },
      scans: {
        orderBy: { scannedAt: "desc" },
        take: 2,
        select: {
          overallScore: true,
          adoptionScore: true,
          rigorScore: true,
          level: true,
          posture: true,
          dimensions: { select: { dimId: true, score: true } },
        },
      },
      contributors: { select: { login: true, name: true, commits: true, aiCommits: true } },
    },
  });

  return rollupTeams(orgSlug, repos);
}
