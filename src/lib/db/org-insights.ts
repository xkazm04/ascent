// Org insight aggregates over the fleet's latest scans: movers (F1), org-level recommendations (F2),
// the assignable backlog, calibration discrepancies, the practice library (P2), cross-repo gap
// analysis, and the corpus benchmark (F6). All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { DIMENSION_BY_ID, weightsFor } from "@/lib/maturity/model";
import { PRACTICES } from "@/lib/practices";
import { projectedGain } from "@/lib/scoring/engine";
import type { DimensionId } from "@/lib/types";
import { IMPACT_WEIGHT, LEVEL_RANK, isBot, segmentScope } from "@/lib/db/org-shared";
import type { OrgWindow } from "@/lib/db/org-rollup";

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
 * latest scan (≤ end) is compared to its baseline (latest scan strictly < start, matching
 * getOrgRollup's half-open cohort), so movers reflect the selected period. Without a window, it
 * falls back to the two most recent scans ("since last scan").
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
    // latest as "now" and the latest STRICTLY before `start` as the baseline (half-open, like rollup).
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
      // Baseline = latest scan STRICTLY before the window start, matching getOrgRollup's half-open
      // `lt: start` cohort so a scan exactly at `start` is classified IDENTICALLY by both surfaces (it
      // belongs to the current window, not the baseline) — the movers panel and the headline period-delta
      // tiles agree on the boundary. A repo ONBOARDED mid-period has no scan before `start`, so fall back
      // to its EARLIEST in-window scan (arr is desc, so the last element) rather than dropping it from
      // movers entirely — it genuinely moved (first score → now) within the window. A repo with a single
      // in-window scan collapses to prev === now and is skipped below.
      const prev = arr.find((s) => s.scannedAt < start) ?? arr[arr.length - 1];
      if (!now || !prev || prev === now) continue; // no baseline, or nothing moved within the window
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
      const [now, prev] = r.scans as [ScanLite, ScanLite]; // safe: length >= 2 checked above
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
  /** Engine-true ROI: overall-score points the repo gains if this dimension's gap is fully
   * closed (projectedGain over the scan's stored dims + archetype). Null when the scan
   * predates persisted dimensions. Display-only — never feeds back into scoring. */
  projectedPoints: number | null;
  /** The maturity level closing this gap crosses into (e.g. "L3"), or null when it stays in band. */
  unlocks: string | null;
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
          // Dimension scores + archetype feed projectedGain — the engine-true "+N pts · unlocks LX"
          // per item, so the backlog can be prioritized on points, not just impact words.
          archetype: true,
          dimensions: { select: { dimId: true, score: true } },
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
    const scan = repo.scans[0];
    const recs = scan?.recommendations ?? [];
    if (recs.length > 0) contributingRepos += 1;
    // Engine-true ROI per dimension, computed once per repo (each scan has ≤ ~6 roadmap rows
    // across ≤ 9 dims). Scans persisted before dimension rows existed project null, not 0.
    const dims = (scan?.dimensions ?? []).map((d) => ({ id: d.dimId, score: d.score }));
    const gainFor = (dimId: string) =>
      dims.length > 0 && scan ? projectedGain(dims, scan.archetype, dimId) : null;
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
      const gain = gainFor(r.dimId);
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
        projectedPoints: gain ? gain.points : null,
        unlocks: gain ? gain.unlocks : null,
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
  overallPercentile: number | null; // org avg overall vs corpus (null below CORPUS_MIN repos — a 1-repo corpus would rank everyone 0th or 100th)
  corpusAvgOverall: number;
  corpusAvgAdoption: number;
  corpusAvgRigor: number;
  /** Peer cohort — corpus repos sharing this org's dominant primary language, for a "vs your peers"
   *  read (more meaningful than the whole corpus). Null when the org has no dominant language or no
   *  same-language peers exist; the percentiles are null below COHORT_MIN peers (too few to rank). */
  cohort: {
    language: string;
    repos: number;
    overallPercentile: number | null;
    adoptionPercentile: number | null;
    avgOverall: number;
  } | null;
}

/** Minimum same-language peers before a cohort percentile is statistically worth showing. */
const COHORT_MIN = 5;
/** Minimum corpus size before the headline percentile is worth showing — same discipline as
 *  COHORT_MIN: a 1–4 repo corpus yields a confidently-wrong "you beat 100% of orgs". */
const CORPUS_MIN = 5;

/** Share of `xs` at-or-below `v`, as 0..100 — null below `min` samples, because a 1-repo corpus
 *  ranks everyone a hard 0th or 100th percentile (no-sample is not a rank). Pure, for unit tests. */
export function percentileOf(xs: readonly number[], v: number, min = 1): number | null {
  if (xs.length < Math.max(1, min)) return null;
  return Math.round((xs.filter((x) => x <= v).length / xs.length) * 100);
}

/** Compare an org's averages against every other repo Ascent has scored (the corpus), plus a
 *  same-language peer cohort for a sharper "vs your peers" read. */
export async function getOrgBenchmark(orgSlug: string): Promise<OrgBenchmark | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  // Latest scan + primary language per repo, for every repo NOT in this org.
  const repos = await prisma.repository.findMany({
    where: { orgId: { not: org.id } },
    select: {
      primaryLanguage: true,
      scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { overallScore: true, adoptionScore: true, rigorScore: true } },
    },
  });
  const corpus: { lang: string | null; overall: number; adoption: number; rigor: number }[] = [];
  for (const r of repos) {
    const s = r.scans[0];
    if (s) corpus.push({ lang: r.primaryLanguage, overall: s.overallScore, adoption: s.adoptionScore, rigor: s.rigorScore });
  }
  if (corpus.length === 0) {
    return { corpusRepos: 0, overallPercentile: null, corpusAvgOverall: 0, corpusAvgAdoption: 0, corpusAvgRigor: 0, cohort: null };
  }

  // This org's averages + dominant language (latest scan per repo).
  const mine = await prisma.repository.findMany({
    where: { orgId: org.id },
    select: {
      primaryLanguage: true,
      scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { overallScore: true, adoptionScore: true } },
    },
  });
  const myOverall: number[] = [];
  const myAdoption: number[] = [];
  const langCounts = new Map<string, number>();
  for (const r of mine) {
    const s = r.scans[0];
    if (!s) continue;
    myOverall.push(s.overallScore);
    myAdoption.push(s.adoptionScore);
    if (r.primaryLanguage) langCounts.set(r.primaryLanguage, (langCounts.get(r.primaryLanguage) ?? 0) + 1);
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const avg = (xs: number[]) => Math.round(mean(xs));
  const myAvgOverall = mean(myOverall);
  const myAvgAdoption = mean(myAdoption);

  // Peer cohort = corpus repos in the org's dominant language.
  const domLang = [...langCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  let cohort: OrgBenchmark["cohort"] = null;
  if (domLang) {
    const peers = corpus.filter((c) => c.lang === domLang);
    if (peers.length > 0) {
      cohort = {
        language: domLang,
        repos: peers.length,
        overallPercentile: percentileOf(peers.map((p) => p.overall), myAvgOverall, COHORT_MIN),
        adoptionPercentile: percentileOf(peers.map((p) => p.adoption), myAvgAdoption, COHORT_MIN),
        avgOverall: avg(peers.map((p) => p.overall)),
      };
    }
  }

  return {
    corpusRepos: corpus.length,
    overallPercentile: percentileOf(corpus.map((c) => c.overall), myAvgOverall, CORPUS_MIN),
    corpusAvgOverall: avg(corpus.map((c) => c.overall)),
    corpusAvgAdoption: avg(corpus.map((c) => c.adoption)),
    corpusAvgRigor: avg(corpus.map((c) => c.rigor)),
    cohort,
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
