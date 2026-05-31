// Enterprise org layer: watchlist, scan scheduling, and the org-rollup query that powers
// the dashboard. All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { DIMENSION_BY_ID, weightsFor } from "@/lib/maturity/model";
import { forecastTrajectory, type Forecast } from "@/lib/maturity/forecast";
import { PRACTICES } from "@/lib/practices";
import type { DimensionId, PrStats } from "@/lib/types";

const LEVEL_RANK: Record<string, number> = { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };
const IMPACT_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };

const SCHEDULE_DAYS: Record<string, number> = { off: 0, daily: 1, weekly: 7, monthly: 30 };

function nextScanFor(schedule: string): Date | null {
  const d = SCHEDULE_DAYS[schedule] ?? 0;
  return d > 0 ? new Date(Date.now() + d * 86_400_000) : null;
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

export interface DueRescan {
  orgSlug: string;
  fullName: string;
  repoId: string;
  scanSchedule: string;
}

/** Repos whose autoscan is due (watched, scheduled, nextScanAt in the past). */
export async function listDueRescans(limit = 50): Promise<DueRescan[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const due = await prisma.repository.findMany({
    where: { watched: true, scanSchedule: { not: "off" }, nextScanAt: { lte: new Date() } },
    select: { id: true, fullName: true, scanSchedule: true, org: { select: { slug: true } } },
    orderBy: { nextScanAt: "asc" },
    take: limit,
  });
  return due.map((r) => ({ orgSlug: r.org.slug, fullName: r.fullName, repoId: r.id, scanSchedule: r.scanSchedule }));
}

/** After an autoscan, advance the repo's next due time. */
export async function advanceSchedule(repoId: string, schedule: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().repository.update({ where: { id: repoId }, data: { nextScanAt: nextScanFor(schedule) } });
}

/** Watched repos for an org (for bulk scan / cron). */
export async function listWatchedRepos(orgSlug: string): Promise<RepoRef[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return [];
  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, watched: true },
    select: { owner: true, name: true, fullName: true, url: true, isPrivate: true },
    orderBy: { fullName: "asc" },
  });
  return repos;
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
export async function getOrgContributors(orgSlug: string): Promise<OrgContributor[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return [];
  const rows = await prisma.repoContributor.findMany({
    where: { repo: { orgId: org.id } },
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
export async function getContributorInsights(orgSlug: string): Promise<ContributorInsights | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const rows = await prisma.repoContributor.findMany({
    where: { repo: { orgId: org.id } },
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
}

export async function getOrgRollup(orgSlug: string): Promise<OrgRollup | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, OR: [{ watched: true }, { scans: { some: {} } }] },
    include: {
      scans: {
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

  // Org maturity trend: avg overall per day across all scans.
  const allScans = await prisma.scan.findMany({
    where: { repo: { orgId: org.id } },
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

  return {
    org: orgSlug,
    repoCount: rows.length,
    scannedCount: scanned.length,
    avgOverall: avg(scanned.map((r) => r.latest!.overall)),
    avgAdoption: avg(scanned.map((r) => r.latest!.adoption)),
    avgRigor: avg(scanned.map((r) => r.latest!.rigor)),
    postureCounts,
    dimAverages,
    repos: rows,
    trend,
    forecast,
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

/** Per-repo change between its two most recent scans — the "what moved" view. */
export async function getOrgMovers(orgSlug: string): Promise<OrgMovers | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id },
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

  const moves: RepoMove[] = [];
  for (const r of repos) {
    if (r.scans.length < 2) continue;
    const [now, prev] = r.scans;
    moves.push({
      fullName: r.fullName,
      name: r.name,
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
    });
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
export async function getOrgRecommendations(orgSlug: string, limit = 8): Promise<OrgRec[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id },
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
  gapRepos: string[]; // repos that could adopt it (score < 40)
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
export async function getOrgGapAnalysis(orgSlug: string): Promise<OrgGapAnalysis | null> {
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
