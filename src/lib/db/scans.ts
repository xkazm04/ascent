// Persistence for scan reports + history/audit queries. Every function is a no-op or
// safe fallback when the DB isn't configured, so callers can wire these in freely
// without breaking the DB-less MVP.

import type {
  Contributor,
  DimensionId,
  DimensionResult,
  Effort,
  Governance,
  Impact,
  LevelId,
  LlmRoadmapItem,
  PersistedRecommendation,
  PrStats,
  ProviderName,
  RecStatus,
  RepoArchetype,
  ScanReport,
} from "@/lib/types";
import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { LEVEL_BY_ID, levelForScore, postureFor } from "@/lib/maturity/model";

const DEFAULT_ORG_SLUG = "public";

/**
 * Append an entry to the audit trail. Returns `true` when the entry was durably
 * recorded (or when persistence is disabled and there is nothing to record), and
 * `false` when the write was attempted but FAILED — so audit-critical callers can
 * react instead of pretending success. The failure is logged loudly with full
 * context (action, org, actor, meta) because a lost audit entry is a compliance gap.
 */
export async function recordAudit(
  action: string,
  meta: Record<string, unknown>,
  opts: { orgId?: string; actorId?: string } = {},
): Promise<boolean> {
  if (!isDbConfigured()) return true;
  try {
    await getPrisma().auditLog.create({
      data: {
        action,
        meta: JSON.stringify(meta),
        orgId: opts.orgId ?? null,
        actorId: opts.actorId ?? null,
      },
    });
    return true;
  } catch (err) {
    console.error("[db] recordAudit FAILED — audit trail entry lost", {
      action,
      orgId: opts.orgId ?? null,
      actorId: opts.actorId ?? null,
      meta,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Find the most recent persisted scan for a repo at an exact commit (dedup lookup). */
export async function findScanByCommit(
  repoId: string,
  headSha: string,
): Promise<{ id: string } | null> {
  if (!isDbConfigured()) return null;
  return getPrisma().scan.findFirst({
    where: { repoId, headSha },
    orderBy: { scannedAt: "desc" },
    select: { id: true },
  });
}

/**
 * The persisted head hint for a repo — the durable backing for a conditional re-scan. Returns
 * the last-seen head sha and the GitHub ETag to send as `If-None-Match`, so a cold serverless
 * instance (in-memory hint gone) can still re-validate an unchanged repo for free. Scoped to
 * `orgSlug` (public, for anonymous scans). Null when persistence is off, the repo is unknown, or
 * no head sha has been recorded yet. `etag` may be null even when a sha exists (older rows).
 */
export async function getHeadHint(
  owner: string,
  name: string,
  opts: { orgSlug?: string } = {},
): Promise<{ headSha: string; etag: string | null } | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgSlug = opts.orgSlug ?? DEFAULT_ORG_SLUG;
  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName: `${owner}/${name}` } },
    select: { headSha: true, headEtag: true },
  });
  if (!repo?.headSha) return null;
  return { headSha: repo.headSha, etag: repo.headEtag ?? null };
}

/** Outcome of persisting a scan report — surfaces dedup and partial-write failures. */
export interface PersistResult {
  scanId: string;
  /** True when an existing scan for this exact commit was reused — no new Scan row was
   *  created (so no redundant LLM persistence and no double usage-based billing). */
  deduped: boolean;
  /** The commit SHA the returned scan is pinned to (null when the source had none). */
  headSha: string | null;
  /** Non-fatal write failures, so a "successful" scan can't silently hide missing data. */
  failures: { audit: boolean; contributors: number };
}

/**
 * Persist a scan report (org -> repository -> scan -> dimensions + recommendations) and
 * write an audit entry. Returns a PersistResult, or null if persistence is disabled.
 *
 * Deduplicates by commit SHA: if a scan for this repo at the same HEAD already exists,
 * it is reused and NO new row is written — avoiding redundant LLM persistence and a
 * second usage-based charge for an unchanged commit (`deduped: true`). Partial write
 * failures (audit trail, contributor rows) are reported rather than swallowed.
 */
export async function persistScanReport(
  report: ScanReport,
  opts: { orgSlug?: string; actorId?: string; headEtag?: string | null } = {},
): Promise<PersistResult | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgSlug = opts.orgSlug ?? DEFAULT_ORG_SLUG;
  const headSha = report.repo.headSha ?? null;

  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    update: {},
    create: { slug: orgSlug, name: orgSlug === DEFAULT_ORG_SLUG ? "Public Scans" : orgSlug },
  });

  const fullName = `${report.repo.owner}/${report.repo.name}`;
  // Refresh the repo's head pointer + conditional-request ETag (the durable, cross-instance
  // copy of the in-memory head hint). `undefined` means "leave as-is": a token/private scan
  // carries no public ETag, so it must not clobber the one a public scan stored.
  const repo = await prisma.repository.upsert({
    where: { orgId_fullName: { orgId: org.id, fullName } },
    update: {
      url: report.repo.url,
      primaryLanguage: report.repo.primaryLanguage ?? null,
      stars: report.repo.stars,
      isPrivate: report.repo.isPrivate ?? false,
      lastScanAt: new Date(report.scannedAt),
      headSha: headSha ?? undefined,
      headEtag: opts.headEtag ?? undefined,
    },
    create: {
      orgId: org.id,
      owner: report.repo.owner,
      name: report.repo.name,
      fullName,
      url: report.repo.url,
      isPrivate: report.repo.isPrivate ?? false,
      primaryLanguage: report.repo.primaryLanguage ?? null,
      stars: report.repo.stars,
      lastScanAt: new Date(report.scannedAt),
      headSha,
      headEtag: opts.headEtag ?? null,
    },
  });

  // Dedup: if this exact commit was already scored, reuse it. The repo row's metadata +
  // lastScanAt were just refreshed above (so the UI can show "up to date as of <sha>"),
  // but we skip creating a duplicate Scan row — the metered, LLM-derived unit.
  if (headSha) {
    const existing = await findScanByCommit(repo.id, headSha);
    if (existing) {
      return { scanId: existing.id, deduped: true, headSha, failures: { audit: false, contributors: 0 } };
    }
  }

  // Carry forward recommendation statuses from this repo's previous scan, so progress
  // isn't lost on re-scan. Match on dimension + title (stable for mock + low-temp LLM).
  const previous = await prisma.scan.findFirst({
    where: { repoId: repo.id },
    orderBy: { scannedAt: "desc" },
    select: { recommendations: { select: { dimId: true, title: true, status: true } } },
  });
  const carry = new Map<string, string>();
  for (const r of previous?.recommendations ?? []) {
    carry.set(`${r.dimId}::${r.title}`, r.status);
  }

  const scan = await prisma.scan.create({
    data: {
      repoId: repo.id,
      headSha: report.repo.headSha ?? null,
      overallScore: report.overallScore,
      level: report.level.id,
      levelName: report.level.name,
      archetype: report.archetype,
      adoptionScore: report.adoptionScore,
      rigorScore: report.rigorScore,
      posture: report.posture.id,
      confidence: report.confidence,
      engineProvider: report.engine.provider,
      engineModel: report.engine.model,
      headline: report.headline,
      strengths: JSON.stringify(report.strengths),
      risks: JSON.stringify(report.risks),
      prStats: report.prStats ? JSON.stringify(report.prStats) : null,
      governance: report.governance ? JSON.stringify(report.governance) : null,
      commitActivity: report.commitActivity ? JSON.stringify(report.commitActivity) : null,
      scannedAt: new Date(report.scannedAt),
      dimensions: {
        create: report.dimensions.map((d) => ({
          dimId: d.id,
          name: d.name,
          weight: d.weight,
          score: d.score,
          signalScore: d.signalScore,
          llmScore: d.llmScore,
          summary: d.summary,
          evidence: JSON.stringify(d.evidence),
          strengths: JSON.stringify(d.strengths),
          gaps: JSON.stringify(d.gaps),
        })),
      },
      recommendations: {
        create: report.roadmap.map((r) => ({
          title: r.title,
          dimId: r.dimension,
          impact: r.impact,
          effort: r.effort,
          rationale: r.rationale,
          explore: JSON.stringify(r.explore ?? []),
          levelUnlock: r.levelUnlock ?? null,
          status: carry.get(`${r.dimension}::${r.title}`) ?? "open",
        })),
      },
    },
  });

  // Persist recent contributors (with AI-attribution) for org-wide comparison. Count any
  // dropped rows so the caller knows the contributor view may be incomplete.
  let contributorFailures = 0;
  for (const c of report.contributors.slice(0, 50)) {
    try {
      await prisma.repoContributor.upsert({
        where: { repoId_login: { repoId: repo.id, login: c.login } },
        update: {
          name: c.name ?? null,
          commits: c.commits,
          aiCommits: c.aiCommits,
          lastActiveAt: c.lastActiveAt ? new Date(c.lastActiveAt) : null,
        },
        create: {
          repoId: repo.id,
          login: c.login,
          name: c.name ?? null,
          commits: c.commits,
          aiCommits: c.aiCommits,
          lastActiveAt: c.lastActiveAt ? new Date(c.lastActiveAt) : null,
        },
      });
    } catch (err) {
      contributorFailures += 1;
      console.error("[db] contributor upsert failed", {
        repo: fullName,
        scanId: scan.id,
        login: c.login,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const auditOk = await recordAudit(
    "scan.created",
    { repo: fullName, scanId: scan.id, headSha, level: report.level.id, score: report.overallScore },
    { orgId: org.id, actorId: opts.actorId },
  );

  return {
    scanId: scan.id,
    deduped: false,
    headSha,
    failures: { audit: !auditOk, contributors: contributorFailures },
  };
}

export interface HistoryPoint {
  id: string;
  overallScore: number;
  level: string;
  levelName: string;
  confidence: number;
  engineProvider: string;
  scannedAt: string;
  dimensions: { dimId: string; score: number }[];
}

export interface RepositoryHistory {
  repo: { owner: string; name: string; fullName: string };
  scans: HistoryPoint[];
}

/**
 * Resolve an org slug to its id — the tenant scope. Returns null when the org doesn't
 * exist. Repo lookups MUST go through this: `fullName` is only unique *within* an org
 * (`@@unique([orgId, fullName])`), so resolving by fullName alone (findFirst) can return
 * another tenant's repo and leak its scores/recommendations across org boundaries.
 */
async function resolveOrgId(orgSlug: string): Promise<string | null> {
  const org = await getPrisma().organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true },
  });
  return org?.id ?? null;
}

/** Prior scans for a repo (most recent first), with per-dimension scores for trends. */
export async function getRepositoryHistory(
  owner: string,
  name: string,
  opts: { orgSlug?: string; limit?: number } = {},
): Promise<RepositoryHistory | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgSlug = opts.orgSlug ?? DEFAULT_ORG_SLUG;
  const limit = opts.limit ?? 30;
  const fullName = `${owner}/${name}`;

  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName } },
  });
  if (!repo) return null;

  const scans = await prisma.scan.findMany({
    where: { repoId: repo.id },
    orderBy: { scannedAt: "desc" },
    take: limit,
    select: {
      id: true,
      overallScore: true,
      level: true,
      levelName: true,
      confidence: true,
      engineProvider: true,
      scannedAt: true,
      dimensions: { select: { dimId: true, score: true } },
    },
  });

  return {
    repo: { owner: repo.owner, name: repo.name, fullName },
    scans: scans.map((s) => ({
      id: s.id,
      overallScore: s.overallScore,
      level: s.level,
      levelName: s.levelName,
      confidence: s.confidence,
      engineProvider: s.engineProvider,
      scannedAt: s.scannedAt.toISOString(),
      dimensions: s.dimensions,
    })),
  };
}

// ---- Scan comparison ("What changed" diff view) ------------------------------
// Two scans of the same repo, rich enough to diff into a story of cause and effect:
// per-dimension score + gap lists, axis/posture inputs, and recommendation statuses.
// No new data model — this just reads more columns of the existing Scan graph than the
// lightweight HistoryPoint (which carries only dimension scores for the trend lines).

/** One dimension of a comparable scan — blended + deterministic scores, the concrete
 *  evidence signals (for appeared/disappeared attribution), and the gap list. */
export interface ComparableDimension {
  dimId: string;
  name: string;
  score: number;
  /** Deterministic signal score (pre-LLM blend) — lets a diff separate evidence-driven
   *  movement from a judgment shift. */
  signalScore: number;
  /** The concrete detector evidence strings (e.g. "Found 18 test files"). */
  evidence: string[];
  gaps: string[];
}

/** A recommendation reduced to what the diff needs: identity (dim::title) + tracked status. */
export interface ComparableRecommendation {
  id: string;
  title: string;
  dimId: string;
  status: string;
}

/** A full scan snapshot for diffing — everything `diffScans` needs from one side. */
export interface ComparableScan {
  id: string;
  scannedAt: string;
  overallScore: number;
  level: string;
  levelName: string;
  archetype: RepoArchetype;
  adoptionScore: number;
  rigorScore: number;
  posture: string;
  confidence: number;
  engineProvider: string;
  headSha: string | null;
  dimensions: ComparableDimension[];
  recommendations: ComparableRecommendation[];
}

export interface ScanComparison {
  repo: { owner: string; name: string; fullName: string };
  /** All scans (newest-first) as lightweight picker options — the two HistoryPoint dropdowns. */
  scans: HistoryPoint[];
  /** Baseline scan (the "before"); null when fewer than two scans exist. */
  before: ComparableScan | null;
  /** Target scan (the "after" — what's being evaluated); null when no scans exist. */
  after: ComparableScan | null;
}

/** Load one scan in full diff detail, scoped to `repoId` so a crafted id from another
 *  tenant's repo can't be loaded by guessing. Returns null when the id isn't this repo's. */
async function loadComparableScan(
  prisma: ReturnType<typeof getPrisma>,
  repoId: string,
  id: string,
): Promise<ComparableScan | null> {
  const scan = await prisma.scan.findFirst({
    where: { id, repoId },
    select: {
      id: true,
      scannedAt: true,
      overallScore: true,
      level: true,
      levelName: true,
      archetype: true,
      adoptionScore: true,
      rigorScore: true,
      posture: true,
      confidence: true,
      engineProvider: true,
      headSha: true,
      dimensions: { select: { dimId: true, name: true, score: true, signalScore: true, evidence: true, gaps: true } },
      recommendations: { select: { id: true, title: true, dimId: true, status: true } },
    },
  });
  if (!scan) return null;
  return {
    id: scan.id,
    scannedAt: scan.scannedAt.toISOString(),
    overallScore: scan.overallScore,
    level: scan.level,
    levelName: scan.levelName,
    archetype: scan.archetype as RepoArchetype,
    adoptionScore: scan.adoptionScore,
    rigorScore: scan.rigorScore,
    posture: scan.posture,
    confidence: scan.confidence,
    engineProvider: scan.engineProvider,
    headSha: scan.headSha,
    dimensions: scan.dimensions.map((d) => ({
      dimId: d.dimId,
      name: d.name,
      score: d.score,
      signalScore: d.signalScore,
      evidence: parseStringArray(d.evidence),
      gaps: parseStringArray(d.gaps),
    })),
    recommendations: scan.recommendations.map((r) => ({
      id: r.id,
      title: r.title,
      dimId: r.dimId,
      status: r.status,
    })),
  };
}

/**
 * Resolve two scans of a repo to compare, plus the full newest-first scan list for the
 * picker. Defaults compare the latest scan against the one immediately before it. A
 * requested `afterId`/`beforeId` that isn't one of this repo's scans falls back to the
 * default rather than erroring (a stale/shared link degrades gracefully). Org-scoped, so
 * a name collision can't surface another tenant's scans. Null when persistence is off or
 * the repo has no scans.
 */
export async function getScanComparison(
  owner: string,
  name: string,
  opts: { orgSlug?: string; afterId?: string; beforeId?: string; limit?: number } = {},
): Promise<ScanComparison | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgSlug = opts.orgSlug ?? DEFAULT_ORG_SLUG;
  const limit = opts.limit ?? 60;
  const fullName = `${owner}/${name}`;

  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName } },
  });
  if (!repo) return null;

  const list = await prisma.scan.findMany({
    where: { repoId: repo.id },
    orderBy: { scannedAt: "desc" },
    take: limit,
    select: {
      id: true,
      overallScore: true,
      level: true,
      levelName: true,
      confidence: true,
      engineProvider: true,
      scannedAt: true,
      dimensions: { select: { dimId: true, score: true } },
    },
  });

  const scans: HistoryPoint[] = list.map((s) => ({
    id: s.id,
    overallScore: s.overallScore,
    level: s.level,
    levelName: s.levelName,
    confidence: s.confidence,
    engineProvider: s.engineProvider,
    scannedAt: s.scannedAt.toISOString(),
    dimensions: s.dimensions,
  }));

  const repoInfo = { owner: repo.owner, name: repo.name, fullName };
  if (scans.length === 0) return { repo: repoInfo, scans, before: null, after: null };

  // Resolve the two ids to diff. "after" is the target (defaults to latest); "before" is
  // the baseline (defaults to the scan immediately older than `after`). Honor requested
  // ids only when they belong to this repo's scan set.
  const ids = new Set(scans.map((s) => s.id));
  const afterId = opts.afterId && ids.has(opts.afterId) ? opts.afterId : scans[0].id;
  const afterIdx = scans.findIndex((s) => s.id === afterId);
  const defaultBeforeId = scans[afterIdx + 1]?.id ?? scans.find((s) => s.id !== afterId)?.id ?? null;
  const beforeId = opts.beforeId && ids.has(opts.beforeId) ? opts.beforeId : defaultBeforeId;

  const [after, before] = await Promise.all([
    loadComparableScan(prisma, repo.id, afterId),
    beforeId ? loadComparableScan(prisma, repo.id, beforeId) : Promise.resolve(null),
  ]);

  return { repo: repoInfo, scans, before, after };
}

// ---- Public scan gallery (landing-page discovery) ----------------------------
// Powers the live "recently scanned" rail + "most AI-native" leaderboard on the landing
// page. Scoped to the PUBLIC org and public repos only, so a tenant's privately-scanned
// repo can never surface here — mirrors how anonymous scans persist (orgSlug "public").

/** A scored public repo, shaped for a landing-page card that links to its pinned report. */
export interface PublicRepoCard {
  owner: string;
  name: string;
  fullName: string;
  level: string; // "L1".."L5"
  levelName: string;
  overall: number;
  adoption: number;
  rigor: number;
  posture: string; // posture id (ai-native | ungoverned | manual | early)
  primaryLanguage: string | null;
  stars: number;
  scannedAt: string; // ISO
  /** Permalink to the pinned report (commit-pinned when the scan recorded a head SHA). */
  href: string;
}

export interface PublicScanGallery {
  /** Latest scan per repo, most recently scanned first. */
  recent: PublicRepoCard[];
  /** Latest scan per repo, highest overall maturity first. */
  topAiNative: PublicRepoCard[];
  /** Distinct public repos with at least one scan — the size of the public corpus. */
  totalRepos: number;
}

/** Stable permalink to a repo's report, pinned to a commit when one is known
 *  (`/report/{owner}/{repo}` or `/report/{owner}/{repo}@{sha}`). */
export function reportPermalink(fullName: string, headSha?: string | null): string {
  return `/report/${fullName}${headSha ? `@${headSha}` : ""}`;
}

/**
 * Public scan gallery for the landing page: a "recently scanned" rail and a "most
 * AI-native" leaderboard, both derived from the latest scan of each PUBLIC repo. Returns
 * null when persistence is disabled or the public org has no scans yet, so the landing
 * page can fall back to its static examples.
 */
export async function getPublicScanGallery(
  opts: { recentLimit?: number; topLimit?: number } = {},
): Promise<PublicScanGallery | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const recentLimit = Math.max(1, opts.recentLimit ?? 12);
  const topLimit = Math.max(1, opts.topLimit ?? 8);

  const orgId = await resolveOrgId(DEFAULT_ORG_SLUG);
  if (!orgId) return null;

  // Latest scan per public repo in the public org; repos with no scan are excluded.
  const repos = await prisma.repository.findMany({
    where: { orgId, isPrivate: false, scans: { some: {} } },
    select: {
      owner: true,
      name: true,
      fullName: true,
      primaryLanguage: true,
      stars: true,
      scans: {
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: {
          headSha: true,
          overallScore: true,
          level: true,
          levelName: true,
          adoptionScore: true,
          rigorScore: true,
          posture: true,
          scannedAt: true,
        },
      },
    },
  });

  const cards: PublicRepoCard[] = [];
  for (const r of repos) {
    const s = r.scans[0];
    if (!s) continue;
    cards.push({
      owner: r.owner,
      name: r.name,
      fullName: r.fullName,
      level: s.level,
      levelName: s.levelName,
      overall: s.overallScore,
      adoption: s.adoptionScore,
      rigor: s.rigorScore,
      posture: s.posture,
      primaryLanguage: r.primaryLanguage ?? null,
      stars: r.stars,
      scannedAt: s.scannedAt.toISOString(),
      href: reportPermalink(r.fullName, s.headSha),
    });
  }
  if (cards.length === 0) return null;

  const recent = [...cards]
    .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt))
    .slice(0, recentLimit);
  const topAiNative = [...cards]
    .sort((a, b) => b.overall - a.overall || b.scannedAt.localeCompare(a.scannedAt))
    .slice(0, topLimit);

  return { recent, topAiNative, totalRepos: cards.length };
}

function toPersistedRec(r: {
  id: string;
  title: string;
  dimId: string;
  impact: string;
  effort: string;
  rationale: string;
  explore?: string;
  levelUnlock: string | null;
  status: string;
}): PersistedRecommendation {
  let explore: string[] = [];
  try {
    const parsed = JSON.parse(r.explore ?? "[]");
    if (Array.isArray(parsed)) explore = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    /* ignore */
  }
  return {
    id: r.id,
    title: r.title,
    dimension: r.dimId as DimensionId,
    impact: r.impact as Impact,
    effort: r.effort as Effort,
    rationale: r.rationale,
    explore,
    levelUnlock: r.levelUnlock ?? undefined,
    status: r.status as RecStatus,
  };
}

/** Recommendations from the most recent scan of a repo (with ids + trackable status). */
export async function getLatestRecommendations(
  owner: string,
  name: string,
  opts: { orgSlug?: string } = {},
): Promise<{ scanId: string; items: PersistedRecommendation[] } | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgSlug = opts.orgSlug ?? DEFAULT_ORG_SLUG;
  const fullName = `${owner}/${name}`;

  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName } },
  });
  if (!repo) return null;

  const scan = await prisma.scan.findFirst({
    where: { repoId: repo.id },
    orderBy: { scannedAt: "desc" },
    select: {
      id: true,
      recommendations: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          dimId: true,
          impact: true,
          effort: true,
          rationale: true,
          explore: true,
          levelUnlock: true,
          status: true,
        },
      },
    },
  });
  if (!scan) return null;

  return { scanId: scan.id, items: scan.recommendations.map(toPersistedRec) };
}

// ---- Pinned snapshot reconstruction (shareable permalinks) -------------------

function parseStringArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/**
 * Rebuild a full ScanReport from a persisted scan — the pinned snapshot behind a
 * `/report/{owner}/{repo}@{headSha}` permalink. With `headSha`, returns that exact commit's
 * scan; without it, the most recent. Returns null when persistence is off or nothing matches.
 */
export async function getScanReportByCommit(
  owner: string,
  name: string,
  opts: { orgSlug?: string; headSha?: string } = {},
): Promise<ScanReport | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgSlug = opts.orgSlug ?? DEFAULT_ORG_SLUG;
  const headSha = opts.headSha;
  const fullName = `${owner}/${name}`;

  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName } },
    include: { contributors: { orderBy: { commits: "desc" }, take: 50 } },
  });
  if (!repo) return null;

  const scan = await prisma.scan.findFirst({
    where: { repoId: repo.id, ...(headSha ? { headSha } : {}) },
    orderBy: { scannedAt: "desc" },
    include: { dimensions: true, recommendations: { orderBy: { createdAt: "asc" } } },
  });
  if (!scan) return null;

  const dimensions: DimensionResult[] = scan.dimensions.map((d) => ({
    id: d.dimId as DimensionId,
    name: d.name,
    weight: d.weight,
    score: d.score,
    signalScore: d.signalScore,
    llmScore: d.llmScore,
    summary: d.summary,
    evidence: parseStringArray(d.evidence),
    strengths: parseStringArray(d.strengths),
    gaps: parseStringArray(d.gaps),
  }));

  const roadmap: LlmRoadmapItem[] = scan.recommendations.map((r) => ({
    title: r.title,
    dimension: r.dimId as DimensionId,
    impact: r.impact as Impact,
    effort: r.effort as Effort,
    rationale: r.rationale,
    explore: parseStringArray(r.explore),
    levelUnlock: r.levelUnlock ?? undefined,
  }));

  const contributors: Contributor[] = repo.contributors.map((c) => ({
    login: c.login,
    name: c.name ?? undefined,
    commits: c.commits,
    aiCommits: c.aiCommits,
    lastActiveAt: c.lastActiveAt ? c.lastActiveAt.toISOString() : undefined,
  }));

  const aiCommitTotal = contributors.reduce((a, c) => a + c.aiCommits, 0);
  const commitTotal = contributors.reduce((a, c) => a + c.commits, 0);
  const level = LEVEL_BY_ID[scan.level as LevelId] ?? levelForScore(scan.overallScore);

  return {
    repo: {
      owner: repo.owner,
      name: repo.name,
      url: repo.url,
      stars: repo.stars,
      forks: 0,
      primaryLanguage: repo.primaryLanguage ?? undefined,
      defaultBranch: "",
      isPrivate: repo.isPrivate,
      headSha: scan.headSha ?? undefined,
    },
    overallScore: scan.overallScore,
    level,
    archetype: scan.archetype as RepoArchetype,
    adoptionScore: scan.adoptionScore,
    rigorScore: scan.rigorScore,
    posture: postureFor(scan.adoptionScore, scan.rigorScore),
    aiUsage: {
      detected: aiCommitTotal > 0,
      commitFraction: commitTotal ? Math.round((aiCommitTotal / commitTotal) * 100) / 100 : 0,
      signals: [],
    },
    contributors,
    prStats: parseJson<PrStats>(scan.prStats),
    governance: parseJson<Governance>(scan.governance),
    commitActivity: parseJson<number[]>(scan.commitActivity),
    dimensions,
    headline: scan.headline,
    strengths: parseStringArray(scan.strengths),
    risks: parseStringArray(scan.risks),
    roadmap,
    discrepancies: [],
    confidence: scan.confidence,
    scannedAt: scan.scannedAt.toISOString(),
    engine: { provider: scan.engineProvider as ProviderName, model: scan.engineModel },
  };
}

/** Update a recommendation's status. Returns null if DB disabled; throws if not found. */
export async function updateRecommendationStatus(
  id: string,
  status: RecStatus,
): Promise<PersistedRecommendation | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const updated = await prisma.recommendation.update({
    where: { id },
    data: { status },
  });
  await recordAudit("recommendation.status_changed", { id, status });
  return toPersistedRec(updated);
}

// ---- Audit log query (org dashboard viewer) ---------------------------------

/** A scan referenced by an audit entry's meta — answers "who triggered the scan that
 *  moved a score". Null when the entry references no (still-present) scan. */
export interface AuditScanRef {
  id: string;
  repo: string | null;
  level: string | null;
  overall: number | null;
  headSha: string | null;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actorId: string | null;
  at: string; // ISO timestamp
  meta: Record<string, unknown>;
  scan: AuditScanRef | null;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  /** Opaque keyset cursor for the next page, or null when there are no more entries. */
  nextCursor: string | null;
}

export interface AuditLogQuery {
  action?: string;
  actorId?: string;
  since?: Date | string;
  until?: Date | string;
  cursor?: string | null;
  limit?: number;
}

function parseMeta(raw: string): Record<string, unknown> {
  try {
    const p = JSON.parse(raw);
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Keyset cursor over the composite sort key (at desc, id desc). `at` alone isn't unique,
// so the id tie-breaker guarantees a stable, gap-free page boundary.
function encodeAuditCursor(row: { at: Date; id: string }): string {
  return Buffer.from(`${row.at.toISOString()}|${row.id}`).toString("base64url");
}

function decodeAuditCursor(cursor: string | null | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const at = new Date(iso);
    if (!id || Number.isNaN(at.getTime())) return null;
    return { at, id };
  } catch {
    return null;
  }
}

/**
 * Read an org's audit trail with filters + keyset pagination, enriching each entry with
 * the scan it references (via meta.scanId) so a viewer can trace who triggered the scan
 * that moved a score. Org-scoped: only entries for `orgSlug` are returned. Returns null
 * when persistence is disabled, or an empty page when the org doesn't exist.
 */
export async function getAuditLog(
  orgSlug: string,
  query: AuditLogQuery = {},
): Promise<AuditLogPage | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return { entries: [], nextCursor: null };

  const limit = Math.min(100, Math.max(1, query.limit ?? 25));

  const where: Prisma.AuditLogWhereInput = { orgId };
  if (query.action) where.action = query.action;
  if (query.actorId) where.actorId = query.actorId;
  const atFilter: Prisma.DateTimeFilter = {};
  if (query.since) atFilter.gte = new Date(query.since);
  if (query.until) atFilter.lte = new Date(query.until);
  if (atFilter.gte || atFilter.lte) where.at = atFilter;

  const cursor = decodeAuditCursor(query.cursor);
  if (cursor) {
    where.OR = [{ at: { lt: cursor.at } }, { at: cursor.at, id: { lt: cursor.id } }];
  }

  // Fetch one extra row to detect whether another page exists.
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const parsed = pageRows.map((r) => ({ row: r, meta: parseMeta(r.meta) }));
  const scanIds = [
    ...new Set(
      parsed
        .map((p) => (typeof p.meta.scanId === "string" ? p.meta.scanId : null))
        .filter((x): x is string => x != null),
    ),
  ];
  const scans = scanIds.length
    ? await prisma.scan.findMany({
        where: { id: { in: scanIds } },
        select: {
          id: true,
          level: true,
          overallScore: true,
          headSha: true,
          repo: { select: { fullName: true } },
        },
      })
    : [];
  const scanById = new Map(scans.map((s) => [s.id, s]));

  const entries: AuditLogEntry[] = parsed.map(({ row, meta }) => {
    const scanId = typeof meta.scanId === "string" ? meta.scanId : null;
    const s = scanId ? scanById.get(scanId) : undefined;
    return {
      id: row.id,
      action: row.action,
      actorId: row.actorId,
      at: row.at.toISOString(),
      meta,
      scan: s
        ? { id: s.id, repo: s.repo?.fullName ?? null, level: s.level, overall: s.overallScore, headSha: s.headSha }
        : null,
    };
  });

  const last = pageRows[pageRows.length - 1];
  return { entries, nextCursor: hasMore && last ? encodeAuditCursor(last) : null };
}
