// Read-side queries over the persisted scan graph: dedup lookups, head hints, repository history +
// trends, the "what changed" comparison, pinned-snapshot reconstruction, the public scan gallery,
// and the latest-recommendations read. All are no-ops/null when the DB isn't configured.

import type {
  Contributor,
  DimensionId,
  DimensionResult,
  Discrepancy,
  Effort,
  Governance,
  Impact,
  LevelId,
  LlmRoadmapItem,
  PersistedRecommendation,
  PrStats,
  ProviderName,
  RepoArchetype,
  ScanReport,
} from "@/lib/types";
import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";
import { getDbMode, type DbMode } from "@/lib/db/mode";
import { isDimensionId, LEVEL_BY_ID, levelForScore, postureFor } from "@/lib/maturity/model";
import { stackFitFromLanguage } from "@/lib/analyze/stack-fit";
import { applyPassportOverrides, parsePassportJson, parsePassportOverrides, type AppPassport } from "@/lib/analyze/passport";
import { projectedGain } from "@/lib/scoring/engine";
import { reportPermalink } from "@/lib/ui";
import { canonicalRepoFullName, DEFAULT_ORG_SLUG, parseStringArray, resolveOrgId, toPersistedRec } from "@/lib/db/scans-shared";

// reportPermalink now lives in @/lib/ui (a client-safe module, so the trend charts can build the
// same link); re-exported here for the existing @/lib/db barrel + server callers.
export { reportPermalink };

/**
 * Deterministic "latest first" ordering for scan reads (scan-persistence-history #3). `scannedAt` is
 * NOT unique — two re-scores can share a timestamp — so a bare `orderBy: { scannedAt: "desc" }`
 * resolves `findFirst` / the head of a `findMany` to an ARBITRARY tied row, and different queries can
 * pick different ones (the report, its recommendations, history, and the comparison disagreeing about
 * which scan is "latest"). `createdAt` then `id` break the tie to the genuinely-latest row, mirroring
 * the persist path's "previous" read (scans-persist.ts).
 */
const SCAN_ORDER: Prisma.ScanOrderByWithRelationInput[] = [
  { scannedAt: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
];

/** Find the most recent persisted scan for a repo at an exact commit (dedup lookup). */
export async function findScanByCommit(
  repoId: string,
  headSha: string,
): Promise<{ id: string } | null> {
  if (!isDbConfigured()) return null;
  return getPrisma().scan.findFirst({
    where: { repoId, headSha },
    orderBy: SCAN_ORDER,
    select: { id: true },
  });
}

/**
 * Dedup fallback for a scan with NO resolvable commit SHA. A sha-less report can't dedup by commit, so
 * the persist path matches on the report's own `scannedAt`: the SAME computed report persisted more
 * than once (coalesced followers, a double-submit, a retried lane) carries an identical timestamp and
 * reuses the first row instead of inserting duplicate sha-less Scan rows. A genuinely new re-score has
 * a later `scannedAt`, so it is not suppressed.
 */
export async function findScanByScannedAt(
  repoId: string,
  scannedAt: Date,
): Promise<{ id: string } | null> {
  if (!isDbConfigured()) return null;
  return getPrisma().scan.findFirst({
    where: { repoId, scannedAt },
    // Deterministic on a timestamp tie (the only thing this sha-less fallback keys on): without an
    // orderBy, findFirst returned an arbitrary matching row. NOTE: equality dedup on a high-precision
    // timestamp is inherently fragile — a stable content/idempotency key would be the authoritative fix
    // (tracked as a follow-up); this just makes the existing behavior deterministic.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
  // The conditional-head OPTIMIZATION is the first DB touch on the public-scan path: when the DB is
  // configured (DATABASE_URL set) but unreachable, resolveOrgId/findUnique throws a
  // PrismaClientInitializationError that propagated out of lookupCachedScan and 500'd the whole scan
  // ("Unexpected error while scanning the repository"). Degrade to null on a DB-down — the caller
  // simply skips the conditional request and runs a fresh scan, exactly as it does with no DB at all.
  return dbReadSafe(async () => {
    const prisma = getPrisma();
    const orgSlug = opts.orgSlug ?? DEFAULT_ORG_SLUG;
    const orgId = await resolveOrgId(orgSlug);
    if (!orgId) return null;
    const repo = await prisma.repository.findUnique({
      where: { orgId_fullName: { orgId, fullName: canonicalRepoFullName(owner, name) } },
      select: { headSha: true, headEtag: true },
    });
    if (!repo?.headSha) return null;
    return { headSha: repo.headSha, etag: repo.headEtag ?? null };
  }, null);
}

/**
 * The stored App Readiness Passport for a repo's latest scan (or a specific commit). Reads the persisted
 * JSON — the passport is derived from a snapshot the read path doesn't have, so it can only be served
 * from storage. Null when off / unknown repo / no scan / no passport. Gating is the CALLER's job (the
 * passport is as sensitive as the report for a private repo) — pass the owning org slug.
 */
export async function getRepoPassport(
  owner: string,
  name: string,
  opts: { orgSlug?: string; headSha?: string } = {},
): Promise<AppPassport | null> {
  if (!isDbConfigured()) return null;
  return dbReadSafe(async () => {
    const prisma = getPrisma();
    const orgId = await resolveOrgId(opts.orgSlug ?? DEFAULT_ORG_SLUG);
    if (!orgId) return null;
    const repo = await prisma.repository.findUnique({
      where: { orgId_fullName: { orgId, fullName: canonicalRepoFullName(owner, name) } },
      select: { id: true, passportOverridesJson: true },
    });
    if (!repo) return null;
    const scan = await prisma.scan.findFirst({
      where: { repoId: repo.id, ...(opts.headSha ? { headSha: opts.headSha } : {}) },
      orderBy: SCAN_ORDER,
      select: { passportJson: true },
    });
    const pp = parsePassportJson(scan?.passportJson);
    // Apply owner overrides (P4) as a read-time overlay over the scan-derived passport.
    return pp ? applyPassportOverrides(pp, parsePassportOverrides(repo.passportOverridesJson)) : null;
  }, null);
}

export interface HistoryPoint {
  id: string;
  /** Commit the scan pinned to, when recorded — lets a trend point deep-link to that exact
   *  report (reportPermalink) and the GitHub commit. Null for legacy scans without a stored sha. */
  headSha: string | null;
  overallScore: number;
  level: string;
  levelName: string;
  confidence: number;
  engineProvider: string;
  /** The specific model that scored this snapshot (e.g. "sonnet"/"us.anthropic.claude-sonnet-4-6"), or
   *  "mock" for a deterministic-floor scan. Surfaced so the audit CSV is model-level, not just
   *  provider-level — an auditor can tell which model graded which quarter. [Tiger P1-5] */
  engineModel: string;
  scannedAt: string;
  dimensions: { dimId: string; score: number }[];
}

export interface RepositoryHistory {
  repo: { owner: string; name: string; fullName: string };
  scans: HistoryPoint[];
}

/** The Scan columns a `HistoryPoint` projects. Shared by every HistoryPoint reader so the picker
 *  shape stays single-sourced (pair with `dimensions` when the per-dimension scores are wanted). */
const HISTORY_POINT_SELECT = {
  id: true,
  headSha: true,
  overallScore: true,
  level: true,
  levelName: true,
  confidence: true,
  engineProvider: true,
  engineModel: true,
  scannedAt: true,
} as const;

/** Map a selected Scan row (with optional `dimensions`) to the wire `HistoryPoint`. */
function historyPointFrom(s: {
  id: string;
  headSha: string | null;
  overallScore: number;
  level: string;
  levelName: string;
  confidence: number;
  engineProvider: string;
  engineModel: string;
  scannedAt: Date;
  dimensions?: { dimId: string; score: number }[];
}): HistoryPoint {
  return {
    id: s.id,
    headSha: s.headSha,
    overallScore: s.overallScore,
    level: s.level,
    levelName: s.levelName,
    confidence: s.confidence,
    engineProvider: s.engineProvider,
    engineModel: s.engineModel,
    scannedAt: s.scannedAt.toISOString(),
    dimensions: s.dimensions ?? [],
  };
}

/**
 * Prior scans for a repo (most recent first), with per-dimension scores for trends.
 *
 * `includeDimensions` (default true) controls the eager per-dimension fan-out: a full history of
 * `limit` scans pulls up to `limit × |dimensions|` ScanDimension rows, but a caller that only charts
 * the OVERALL line (a first paint, an embed, the /api/history `?dims=0` mode) doesn't need them.
 * Passing `false` skips that select entirely and returns empty `dimensions` arrays — a lighter query
 * for the overall-only path, with the by-dimension data fetched separately when actually shown.
 */
export async function getRepositoryHistory(
  owner: string,
  name: string,
  opts: { orgSlug?: string; limit?: number; includeDimensions?: boolean } = {},
): Promise<RepositoryHistory | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgSlug = opts.orgSlug ?? DEFAULT_ORG_SLUG;
  // Clamp to a positive bounded range: a NEGATIVE `take` makes Prisma return rows from the OTHER end,
  // so a caller passing limit<0 (a buggy/probing query param) would silently get the OLDEST scans
  // instead of the newest — and an unbounded large limit is a cheap heavy query. Coerce NaN to 30.
  const limit = Math.max(1, Math.min(200, Math.trunc(opts.limit ?? 30) || 30));
  const includeDimensions = opts.includeDimensions ?? true;
  const fullName = canonicalRepoFullName(owner, name);

  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName } },
  });
  if (!repo) return null;
  // Defense-in-depth (cross-tenant disclosure): a private repo's history is never served from the
  // shared public org (the anonymous read surface). Mirrors the guard in getScanReportByCommit.
  if (orgSlug === DEFAULT_ORG_SLUG && repo.isPrivate) return null;

  // Two statically-typed queries (rather than a dynamic select) so the result type stays precise:
  // the light branch genuinely omits the dimensions join at the DB, not just in the mapping. Each
  // branch maps through historyPointFrom (a single array type, never a union, so it stays type-safe).
  const args = { where: { repoId: repo.id }, orderBy: SCAN_ORDER, take: limit } as const;

  const scans: HistoryPoint[] = includeDimensions
    ? (
        await prisma.scan.findMany({
          ...args,
          select: { ...HISTORY_POINT_SELECT, dimensions: { select: { dimId: true, score: true } } },
        })
      ).map(historyPointFrom)
    : (await prisma.scan.findMany({ ...args, select: HISTORY_POINT_SELECT })).map(historyPointFrom);

  return {
    repo: { owner: repo.owner, name: repo.name, fullName },
    scans,
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
  // Clamp to a positive bounded range (scan-persistence-history #4): a NEGATIVE `take` makes Prisma
  // read from the OTHER end (oldest-first), so the diff would default `afterId` to the OLDEST scan and
  // target the wrong commit; NaN and an unbounded huge limit are also unhandled (a cheap heavy query).
  // Coerce NaN to 60. Mirrors the guard the sibling getRepositoryHistory already applies.
  const limit = Math.max(1, Math.min(200, Math.trunc(opts.limit ?? 60) || 60));
  const fullName = canonicalRepoFullName(owner, name);

  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName } },
  });
  if (!repo) return null;
  // Defense-in-depth (cross-tenant disclosure): never serve a PRIVATE repo's comparison (overall +
  // per-dimension scores, evidence, gaps, recommendations) out of the shared public org — that org is
  // the anonymous read surface, and an unauthorized visitor resolves to it via readableOrgForOwner.
  // Mirrors the identical guard in getRepositoryHistory and getScanReportByCommit (the third twin
  // reader was the only public-org read path missing it). Backstops a legacy pre-guard row.
  if (orgSlug === DEFAULT_ORG_SLUG && repo.isPrivate) return null;

  const list = await prisma.scan.findMany({
    where: { repoId: repo.id },
    orderBy: SCAN_ORDER,
    take: limit,
    select: { ...HISTORY_POINT_SELECT, dimensions: { select: { dimId: true, score: true } } },
  });

  const scans: HistoryPoint[] = list.map(historyPointFrom);

  const repoInfo = { owner: repo.owner, name: repo.name, fullName };
  if (scans.length === 0) return { repo: repoInfo, scans, before: null, after: null };

  // Resolve the two ids to diff. "after" is the target (defaults to latest); "before" is
  // the baseline (defaults to the scan immediately older than `after`). Honor requested
  // ids only when they belong to this repo's scan set.
  const ids = new Set(scans.map((s) => s.id));
  const afterId = opts.afterId && ids.has(opts.afterId) ? opts.afterId : scans[0]!.id; // safe: scans.length > 0 checked above
  const afterIdx = scans.findIndex((s) => s.id === afterId);
  // The default baseline is the scan immediately OLDER than `after` (scans is newest-first). When
  // `after` IS the oldest scan there is no older one, so leave `before` null rather than reaching
  // FORWARD to a newer scan (scan-persistence-history #5): a forward baseline inverts the time axis,
  // making every delta read backward (a real improvement shows as a regression). The page renders a
  // missing `before` gracefully.
  const defaultBeforeId = scans[afterIdx + 1]?.id ?? null;
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
  /** Per-dimension scores (D1..D9) from this scan — powers the register's per-dimension columns.
   *  Partial: a dimension a partial scan didn't persist is simply absent. */
  dimensions: Partial<Record<DimensionId, number>>;
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
  /** Which database backend served this gallery — drives the "served live from Aurora DSQL"
   *  indicator on the landing register, so the AWS database in use is visible on screen. */
  dbMode: DbMode;
}

// Upper bound on the candidate repos EACH gallery rail materializes. The page shows only ~12 + ~8
// cards, but the two rails are ranked DIFFERENTLY (recency vs score), so they need two independent
// bounded candidate windows — see loadPublicGalleryCards. Reusing a single recency-capped window for
// both made the leaderboard silently mean "top within the recently-touched N" once the public corpus
// grew past the cap: a genuinely high-scoring repo that hadn't been re-scanned lately fell outside it.
const GALLERY_CANDIDATE_CAP = 200;

// Repository projection shared by both candidate windows so the two queries stay byte-identical and the
// card builder sees one type. `id` backs the cross-window dedup; the nested `scans` pick is the latest
// scan per repo (tie-broken beyond bare scannedAt — see scans-persist — so it's deterministic on a tie).
const GALLERY_REPO_SELECT = Prisma.validator<Prisma.RepositorySelect>()({
  id: true,
  owner: true,
  name: true,
  fullName: true,
  primaryLanguage: true,
  stars: true,
  scans: {
    orderBy: [{ scannedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
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
      dimensions: { select: { dimId: true, score: true } },
    },
  },
});

type GalleryRepoRow = Prisma.RepositoryGetPayload<{ select: typeof GALLERY_REPO_SELECT }>;

/** Project a repo + its latest scan into a gallery card; null when the repo has no scan row. */
function galleryCardFrom(r: GalleryRepoRow): PublicRepoCard | null {
  const s = r.scans[0];
  if (!s) return null;
  const dimensions: Partial<Record<DimensionId, number>> = {};
  for (const d of s.dimensions) {
    if (isDimensionId(d.dimId)) dimensions[d.dimId] = d.score;
  }
  return {
    owner: r.owner,
    name: r.name,
    fullName: r.fullName,
    level: s.level,
    levelName: s.levelName,
    overall: s.overallScore,
    adoption: s.adoptionScore,
    rigor: s.rigorScore,
    dimensions,
    posture: s.posture,
    primaryLanguage: r.primaryLanguage ?? null,
    stars: r.stars,
    scannedAt: s.scannedAt.toISOString(),
    href: reportPermalink(r.fullName, s.headSha),
  };
}

/**
 * The DB-derived half of the public scan gallery, cached across requests with `unstable_cache`. The
 * landing page is the hottest route and `force-dynamic`, so without this each hit re-ran the corpus
 * query (and the codebase has no other data cache). The data is session-independent, so a short shared
 * TTL turns N homepage renders into one DB pass per window. `orgId` is resolved by the caller and passed
 * in — no request-scoped read runs inside the cache scope — and is part of the cache key. The returned
 * shape is fully serializable (scannedAt is pre-stringified).
 */
const loadPublicGalleryCards = unstable_cache(
  async (
    orgId: string,
    recentLimit: number,
    topLimit: number,
  ): Promise<{ recent: PublicRepoCard[]; topAiNative: PublicRepoCard[]; totalRepos: number } | null> => {
    const prisma = getPrisma();
    const where = { orgId, isPrivate: false, scans: { some: {} } } as const;

    // Two INDEPENDENT candidate windows, one per rail (a single recency-capped window can't serve both):
    //  - recency rail: the CAP most-recently-active repos. `updatedAt` bumps on every scan upsert, and a
    //    public repo is only ever mutated by scanning, so ordering by it ≈ "most recently scanned".
    //  - leaderboard: the CAP highest-scoring public SCANS, reduced to their repos — so a high-scoring
    //    repo that hasn't been re-scanned lately still qualifies, independent of recency. We rank by each
    //    repo's actual LATEST scan below, so a stale high score is corrected (and typically drops off).
    // `totalRepos` is a separate COUNT so the displayed corpus size stays exact despite the caps.
    const [recentRepos, topScoreScans, totalRepos] = await Promise.all([
      prisma.repository.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: GALLERY_CANDIDATE_CAP,
        select: GALLERY_REPO_SELECT,
      }),
      prisma.scan.findMany({
        where: { repo: { orgId, isPrivate: false } },
        orderBy: [{ overallScore: "desc" }, { scannedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: GALLERY_CANDIDATE_CAP,
        select: { repoId: true },
      }),
      prisma.repository.count({ where }),
    ]);

    // Materialize the leaderboard candidates NOT already loaded by the recency window (dedup by id).
    const recentIds = new Set(recentRepos.map((r) => r.id));
    const extraIds = Array.from(new Set(topScoreScans.map((s) => s.repoId))).filter((id) => !recentIds.has(id));
    const extraRepos = extraIds.length
      ? await prisma.repository.findMany({ where: { id: { in: extraIds } }, select: GALLERY_REPO_SELECT })
      : [];

    const cards: PublicRepoCard[] = [];
    for (const r of [...recentRepos, ...extraRepos]) {
      const card = galleryCardFrom(r);
      if (card) cards.push(card);
    }
    if (cards.length === 0) return null;

    // Recency rail sorts the full pool by scannedAt; the extra (leaderboard-only) repos are older than
    // the recency window by construction, so they can't intrude on the top of the recency slice.
    const recent = [...cards]
      .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt))
      .slice(0, recentLimit);
    const topAiNative = [...cards]
      .sort((a, b) => b.overall - a.overall || b.scannedAt.localeCompare(a.scannedAt))
      .slice(0, topLimit);

    return { recent, topAiNative, totalRepos };
  },
  ["public-scan-gallery"],
  { revalidate: 60, tags: ["public-scan-gallery"] },
);

/**
 * Public scan gallery for the landing page: a "recently scanned" rail and a "most
 * AI-native" leaderboard, both derived from the latest scan of each PUBLIC repo. Returns
 * null when persistence is disabled or the public org has no scans yet, so the landing
 * page can fall back to its static examples. The corpus query itself is bounded + cached
 * (loadPublicGalleryCards); only the live-backend label is resolved fresh per request.
 */
export async function getPublicScanGallery(
  opts: { recentLimit?: number; topLimit?: number } = {},
): Promise<PublicScanGallery | null> {
  if (!isDbConfigured()) return null;
  const recentLimit = Math.max(1, opts.recentLimit ?? 12);
  const topLimit = Math.max(1, opts.topLimit ?? 8);

  // Resolve the public org id OUTSIDE the cache scope (unstable_cache must not wrap request-scoped reads).
  const orgId = await resolveOrgId(DEFAULT_ORG_SLUG);
  if (!orgId) return null;

  const data = await loadPublicGalleryCards(orgId, recentLimit, topLimit);
  if (!data) return null;
  // dbMode reflects the live backend (env/global signals), not cached row data — merge it in per request.
  return { ...data, dbMode: getDbMode() };
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
  const fullName = canonicalRepoFullName(owner, name);

  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName } },
  });
  if (!repo) return null;

  const scan = await prisma.scan.findFirst({
    where: { repoId: repo.id },
    orderBy: SCAN_ORDER,
    select: {
      id: true,
      // Dimension scores + archetype feed projectedGain — engine-true "+N pts · unlocks LX" per
      // item, mirroring the live report's PayoffChip on the persisted read path.
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
          rationale: true,
          explore: true,
          levelUnlock: true,
          status: true,
          assigneeLogin: true,
          targetDate: true,
        },
      },
    },
  });
  if (!scan) return null;

  const dims = scan.dimensions.map((d) => ({ id: d.dimId, score: d.score }));
  const items = scan.recommendations.map((r) => {
    const base = toPersistedRec(r);
    if (dims.length === 0) return base; // pre-dimension scan rows — no projection, not a fake 0
    const gain = projectedGain(dims, scan.archetype, r.dimId);
    return { ...base, projectedPoints: gain.points, unlocks: gain.unlocks };
  });
  return { scanId: scan.id, items };
}

// ---- Pinned snapshot reconstruction (shareable permalinks) -------------------
// parseStringArray now lives in scans-shared (the dependency sink) — imported above.

function parseJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/**
 * Parse persisted JSON that MUST be a plain object. A valid-JSON-but-wrong-shape row (stored as an
 * array, number, or string) returns null instead of being blindly cast to T — so a corrupted
 * `prStats`/`governance` column can't reach client charts as something that isn't the expected
 * object (where field access / numeric coercion would render NaN or throw).
 */
function parseJsonObject<T>(s: string | null | undefined): T | null {
  const p = parseJson<unknown>(s);
  return p !== null && typeof p === "object" && !Array.isArray(p) ? (p as T) : null;
}

/**
 * Parse persisted JSON that MUST be an array of finite numbers. Non-array input returns null;
 * non-finite/non-number entries (NaN, strings, an object slipped into the array) are dropped. This
 * guards the commit-activity sparkline from a `.map` on a non-array or a NaN-positioned SVG point
 * when a row was hand-edited or written by an older/buggy path.
 */
function parseNumberArray(s: string | null | undefined): number[] | null {
  const p = parseJson<unknown>(s);
  if (!Array.isArray(p)) return null;
  return p.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
}

/** Parse the persisted `discrepancies` JSON into validated Discrepancy[] (drops malformed rows). */
function parseDiscrepancies(s: string | null | undefined): Discrepancy[] {
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    if (!Array.isArray(p)) return [];
    return p
      .filter((d): d is { dimension: string; claim: string } => !!d && typeof d.dimension === "string" && typeof d.claim === "string")
      .map((d) => ({ dimension: d.dimension as DimensionId, claim: d.claim }));
  } catch {
    return [];
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
  const fullName = canonicalRepoFullName(owner, name);

  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName } },
    include: { contributors: { orderBy: { commits: "desc" }, take: 50 } },
  });
  if (!repo) return null;
  // Defense-in-depth (cross-tenant disclosure): never serve a PRIVATE repo's report out of the shared
  // public org — that org is the anonymous read surface (the report page / history resolve to it for
  // any visitor without the installation). Backstops a legacy row from before the persist-side guard.
  if (orgSlug === DEFAULT_ORG_SLUG && repo.isPrivate) return null;

  const scan = await prisma.scan.findFirst({
    where: { repoId: repo.id, ...(headSha ? { headSha } : {}) },
    orderBy: SCAN_ORDER,
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

  // Contributors are stored as a per-repo LATEST-scan snapshot (persistScanReport replaces them
  // wholesale on every scan), so they describe `scan` ONLY when `scan` is the latest. For an older
  // pinned commit (a shared/permalinked @sha that isn't the current head) returning today's
  // contributors — and the aiUsage headline derived from them — would make the snapshot silently
  // assert wrong, time-shifted people. Surface them only when this scan is the latest; blank them for
  // an older pin rather than claim stale data. (A faithful per-scan contributor history needs a
  // ScanContributor join — tracked as a follow-up.)
  const isLatestScan = !headSha || (repo.headSha != null && scan.headSha === repo.headSha);
  const contributors: Contributor[] = isLatestScan
    ? repo.contributors.map((c) => ({
        login: c.login,
        name: c.name ?? undefined,
        commits: c.commits,
        aiCommits: c.aiCommits,
        lastActiveAt: c.lastActiveAt ? c.lastActiveAt.toISOString() : undefined,
      }))
    : [];

  const aiCommitTotal = contributors.reduce((a, c) => a + c.aiCommits, 0);
  const commitTotal = contributors.reduce((a, c) => a + c.commits, 0);
  const level = LEVEL_BY_ID[scan.level as LevelId] ?? levelForScore(scan.overallScore);

  // Warnings aren't persisted, so recompute the durable stack-fit caveat from the stored primary
  // language — keeps a partial-fit reload (ML notebook / mobile repo) honest, not just the fresh scan.
  const stackFit = stackFitFromLanguage(repo.primaryLanguage);

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
    prStats: parseJsonObject<PrStats>(scan.prStats),
    governance: parseJsonObject<Governance>(scan.governance),
    commitActivity: parseNumberArray(scan.commitActivity),
    dimensions,
    headline: scan.headline,
    strengths: parseStringArray(scan.strengths),
    risks: parseStringArray(scan.risks),
    roadmap,
    discrepancies: parseDiscrepancies(scan.discrepancies),
    confidence: scan.confidence,
    ...(stackFit ? { warnings: [stackFit.caveat] } : {}),
    scannedAt: scan.scannedAt.toISOString(),
    engine: { provider: scan.engineProvider as ProviderName, model: scan.engineModel },
  };
}
