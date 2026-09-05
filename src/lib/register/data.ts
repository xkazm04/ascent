// The PUBLIC register data layer — the one read path behind every crawlable, unauthenticated ranking
// surface (`/leaderboard`, `/scorecard/[owner]`, `/api/scorecard/[owner]/badge`).
//
// TWO INVARIANTS, both load-bearing, both asserted in data.test.ts:
//
//  1. TENANCY. Every query is pinned to the shared PUBLIC org (`DEFAULT_ORG_SLUG`) AND to
//     `isPrivate: false`, and BOTH predicates are re-asserted on the second (id-keyed) fetch rather
//     than trusted from the first. A private repo's row can exist under the public org (a legacy
//     persist, or a repo that went private after being scanned), so "it came back from a public-org
//     query" is not proof — the private flag is the proof, and it is checked on every read.
//
//  2. PROVENANCE. A scan whose engine was the deterministic `mock` rubric had NO model contribution.
//     Those entries are carried out as `verified: false` and are NEVER interleaved into the ranked
//     board — a register that silently ranks a mock score against a real one is worse than no
//     register. Callers render them in a separate, explicitly-labelled "not independently scored"
//     section. Mirrors the badge's `· demo` qualifier and the share card's refusal to draw a number
//     for an incomplete scan.
//
//     The SAME sentence applies to the rubric. `model.ts` states in writing that an r10 number is not
//     comparable with an r11 one ("D1 stopped counting FORMATS and started scoring COHERENCE"), and
//     `rubricVersion` is load-bearing everywhere else in the codebase: the corpus benchmark filters on
//     it, the outcome ledger REFUSES to pair two scans across a bump, the digest keys include it. The
//     register carried every other provenance qualifier and not this one (UAT `TOMAS-L1-11`), while a
//     rubric bump invalidates the cache WITHOUT re-scanning — so a repo nobody re-scanned keeps its old
//     row and is ranked today against fresh ones.
//
//     A stale-rubric row is therefore QUALIFIED — `currentRubric: false`, a `rubric rNN` chip, and a
//     note under the board — and deliberately NOT de-ranked the way a mock row is. The two cases are
//     not the same claim: a mock score had no model in it at all and is not a rating, whereas a stale
//     score is a real rating taken with an earlier instrument. Dropping every pre-bump row would empty
//     the board on the day of every bump (r13→r14→r15 inside 48 hours) and publish a register that is
//     less true, not more. An UNKNOWN rubric (a legacy row with a null column) is not current either —
//     unknown is never "the same", exactly as the outcome ledger reads it.
//
// No new columns, no new indexes: `Scan.engineProvider` and `Repository.isPrivate` already exist, and
// ranking happens over a BOUNDED candidate window in memory (the same shape `getPublicScanGallery`
// uses) so nothing here needs a migration.

import { Prisma } from "@prisma/client";
import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";
import { DEFAULT_ORG_SLUG, resolveOrgId } from "@/lib/db/scans-shared";
import { SCORING_RUBRIC_VERSION, isDimensionId, levelForScore } from "@/lib/maturity/model";
import { reportPermalink } from "@/lib/ui";
import type { DimensionId } from "@/lib/types";

/** One repository in the public register. */
export interface RegisterEntry {
  owner: string;
  name: string;
  fullName: string;
  level: string; // "L1".."L5"
  levelName: string;
  overall: number;
  adoption: number;
  rigor: number;
  dimensions: Partial<Record<DimensionId, number>>;
  primaryLanguage: string | null;
  stars: number;
  scannedAt: string; // ISO
  /** Permalink to the pinned report (commit-pinned when the scan recorded a head SHA). */
  href: string;
  /** The engine that produced this score ("mock" = the deterministic rubric, no model). */
  engineProvider: string;
  /** False when the score came from the deterministic mock rubric — never ranked, always labelled. */
  verified: boolean;
  /** The scan's own confidence in its judgement (0..1). Carried onto the public surface so a
   *  weaker read is visibly a weaker read — a register that prints 0.62-confidence and
   *  0.85-confidence scores in the same column with no marker is overclaiming the first. */
  confidence: number;
  /** False when the scan's PR window contains no MERGED pull request (or no PR slice at all).
   *  Deliberately the measured claim and nothing more: code mirrors produce it (their drive-by PRs
   *  close unmerged — the canonical embedded-database mirror shows 46 PRs ever, 0 merged), and so
   *  do push-based workflows. Either way, every PR-shaped process signal — reviews, merge
   *  governance, AI-PR rates — reads as absent rather than measured, and the surface says so
   *  instead of letting the depressed score stand bare. Broader "is this a mirror" inference was
   *  tried against real rows and rejected: total-PR counts and merged counts both misclassify
   *  (a staging mirror showed 6 merged PRs), so the register labels only what it measured. */
  hasProcessSignals: boolean;
  /** The rubric this score was computed under ("r15"), or null on a row scored before the column. */
  rubricVersion: string | null;
  /** True only when the score was taken with the rubric in force NOW. A null version is UNKNOWN and
   *  therefore NOT current — the same reading `db/outcomes.ts` gives it when refusing to pair. */
  currentRubric: boolean;
}

export interface PublicRegister {
  /** Model-scored entries for the requested page, highest overall first. Rank = the board position. */
  entries: RegisterEntry[];
  /** Mock-scored entries (page 1 only) — shown separately and labelled, never ranked. */
  unverified: RegisterEntry[];
  /** Model-scored repos in the candidate window — the denominator for the rank + the pager. */
  totalVerified: number;
  /** Distinct public repos with at least one scan (the whole corpus, ranked or not). */
  totalRepos: number;
  page: number;
  perPage: number;
  totalPages: number;
  /** True when the corpus is larger than the candidate window, so the ranking is "top N", not global. */
  windowed: boolean;
  /** The rubric in force now — what a `currentRubric: true` row was scored under. */
  rubricVersion: string;
  /** Ranked entries ON THIS PAGE scored under an earlier (or unrecorded) rubric. Zero means the page
   *  is on one ruler and needs no disclosure. */
  staleRubricOnPage: number;
}

/** The public scorecard for one GitHub owner, aggregated from its PUBLIC repos only. */
export interface PublicOrgScorecard {
  /** Display casing, as recorded on the repository rows. */
  owner: string;
  /** Mean overall score across MODEL-SCORED public repos (0 when none). */
  avgOverall: number;
  avgAdoption: number;
  avgRigor: number;
  /** Mean per-dimension score across model-scored public repos. */
  dimensions: Partial<Record<DimensionId, number>>;
  level: string;
  levelName: string;
  /** Public repos with at least one scan. */
  repoCount: number;
  /** …of which were scored by a real model. Only these feed the averages / the badge. */
  verifiedCount: number;
  /** Most recent scan across the counted repos (ISO), or null. */
  scannedAt: string | null;
  /** The counted repos, ranked — model-scored first. */
  repos: RegisterEntry[];
  /** The rubric in force now. */
  rubricVersion: string;
  /** …of the `verifiedCount` repos feeding the averages, how many were scored under an earlier (or
   *  unrecorded) rubric. Non-zero means this owner's average mixes instruments, and the page says so.
   *  Counted rather than excluded: dropping them would publish an average over a smaller, arbitrary
   *  slice of the owner's repos, which is a worse claim than a disclosed mixed one. */
  staleRubricCount: number;
}

// Upper bound on the repos any one register/scorecard read materializes. The board shows a page at a
// time, but ranking is done in memory, so the candidate window is what "top" actually means. Kept at
// the gallery's order of magnitude; `windowed` discloses when the corpus outgrew it.
export const REGISTER_CANDIDATE_CAP = 500;
export const REGISTER_PER_PAGE = 25;

// Deterministic "latest scan" ordering, tie-broken beyond bare scannedAt exactly as the persist layer
// documents. NOT `as const` — Prisma's orderBy input is a mutable array type.
const SCAN_ORDER: Prisma.ScanOrderByWithRelationInput[] = [
  { scannedAt: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
];

const REGISTER_REPO_SELECT = Prisma.validator<Prisma.RepositorySelect>()({
  id: true,
  owner: true,
  name: true,
  fullName: true,
  // Selected so the mapper can re-assert it per row — the second half of invariant 1. A `where`
  // clause is a filter; this is the check that survives a future refactor of that clause.
  isPrivate: true,
  primaryLanguage: true,
  stars: true,
  scans: {
    orderBy: SCAN_ORDER,
    take: 1,
    select: {
      headSha: true,
      overallScore: true,
      level: true,
      levelName: true,
      adoptionScore: true,
      rigorScore: true,
      engineProvider: true,
      confidence: true,
      rubricVersion: true,
      prStats: true,
      scannedAt: true,
      dimensions: { select: { dimId: true, score: true } },
    },
  },
});

type RegisterRepoRow = Prisma.RepositoryGetPayload<{ select: typeof REGISTER_REPO_SELECT }>;

/**
 * Map a repository row + its latest scan onto a register entry, or null when it must not be published.
 *
 * Returns null for a PRIVATE repo unconditionally — this is the enforcement point for invariant 1, and
 * it runs on every row from every query in this module, so no future caller can route around it.
 */
export function registerEntryFrom(r: RegisterRepoRow): RegisterEntry | null {
  if (r.isPrivate) return null; // never publish a private repo, whatever the query returned
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
    primaryLanguage: r.primaryLanguage ?? null,
    stars: r.stars,
    scannedAt: s.scannedAt.toISOString(),
    href: reportPermalink(r.fullName, s.headSha),
    engineProvider: s.engineProvider,
    // A mock-engine scan means no model contributed a judgement. It is a preview, not a rating.
    verified: s.engineProvider !== "mock",
    confidence: s.confidence,
    hasProcessSignals: hasProcessSignalsFrom(s.prStats),
    rubricVersion: s.rubricVersion,
    // Never `!= current`: a null column is unknown, and unknown is not current.
    currentRubric: s.rubricVersion === SCORING_RUBRIC_VERSION,
  };
}

/** True when the scan's PR window contains at least one merged pull request. Malformed or absent
 *  prStats counts as "no signal" — the honest reading for mirrors, whose windows genuinely hold
 *  none, and the conservative one for a failed slice (the flag only ever ADDS a caveat). */
function hasProcessSignalsFrom(prStats: string | null): boolean {
  if (!prStats) return false;
  try {
    const parsed = JSON.parse(prStats) as { merged?: unknown };
    return typeof parsed.merged === "number" && parsed.merged > 0;
  } catch {
    return false;
  }
}

/** Rank comparator: score desc, then the more recent scan, then a stable name tiebreak. */
function byRank(a: RegisterEntry, b: RegisterEntry): number {
  return b.overall - a.overall || b.scannedAt.localeCompare(a.scannedAt) || a.fullName.localeCompare(b.fullName);
}

/**
 * Load the bounded candidate window of PUBLIC repos in the PUBLIC org, ranked by their best scan.
 * `ownerPrefix` (already lowercased, no slash) narrows to one owner for the scorecard read.
 */
async function loadCandidates(orgId: string, ownerPrefix?: string): Promise<RegisterEntry[]> {
  const prisma = getPrisma();
  // Tenancy is expressed on the SCAN's repo relation as well as on the repository fetch below, so
  // neither query can widen on its own.
  const repoWhere: Prisma.RepositoryWhereInput = {
    orgId,
    isPrivate: false,
    ...(ownerPrefix ? { fullName: { startsWith: `${ownerPrefix}/` } } : {}),
  };

  // Candidate window = the highest-scoring public SCANS, reduced to their repos. Ordering by score at
  // the DB (rather than by recency) is what makes "top N" mean top-by-score once the corpus outgrows
  // the cap — the failure mode the gallery documents.
  const topScans = await prisma.scan.findMany({
    where: { repo: repoWhere },
    orderBy: [{ overallScore: "desc" }, { scannedAt: "desc" }, { id: "desc" }],
    take: REGISTER_CANDIDATE_CAP,
    select: { repoId: true },
  });
  const ids = Array.from(new Set(topScans.map((s) => s.repoId)));
  if (ids.length === 0) return [];

  // Re-assert BOTH tenancy predicates on the id-keyed fetch. An id list is caller-independent here, but
  // the constraint this module exists to hold is "verify tenancy on every read" — so it is verified
  // again, and once more per row in registerEntryFrom.
  const repos = await prisma.repository.findMany({
    where: { id: { in: ids }, ...repoWhere },
    select: REGISTER_REPO_SELECT,
  });

  const entries: RegisterEntry[] = [];
  for (const r of repos) {
    const e = registerEntryFrom(r);
    if (e) entries.push(e);
  }
  return entries.sort(byRank);
}

/**
 * The public register: a page of MODEL-SCORED public repos ranked by overall maturity, plus the
 * mock-scored ones carried separately so the caller can label them instead of ranking them.
 *
 * Null when persistence is off / the public org has no scans / the DB is unreachable — the page then
 * renders its "nothing scored yet" state rather than 500ing a public, crawled URL.
 */
export async function getPublicRegister(
  opts: { page?: number; perPage?: number } = {},
): Promise<PublicRegister | null> {
  if (!isDbConfigured()) return null;
  const perPage = Math.max(1, Math.min(100, Math.trunc(opts.perPage ?? REGISTER_PER_PAGE) || REGISTER_PER_PAGE));
  const page = Math.max(1, Math.trunc(opts.page ?? 1) || 1);

  return dbReadSafe(async () => {
    const orgId = await resolveOrgId(DEFAULT_ORG_SLUG);
    if (!orgId) return null;
    const prisma = getPrisma();
    const [candidates, totalRepos] = await Promise.all([
      loadCandidates(orgId),
      prisma.repository.count({ where: { orgId, isPrivate: false, scans: { some: {} } } }),
    ]);
    if (candidates.length === 0) return null;

    const verified = candidates.filter((e) => e.verified);
    const unverified = candidates.filter((e) => !e.verified);
    const totalPages = Math.max(1, Math.ceil(verified.length / perPage));
    const clamped = Math.min(page, totalPages);
    const start = (clamped - 1) * perPage;
    const entries = verified.slice(start, start + perPage);
    return {
      entries,
      // The unranked tail belongs on page 1 only — it is context for the board, not a second board.
      unverified: clamped === 1 ? unverified : [],
      totalVerified: verified.length,
      totalRepos,
      page: clamped,
      perPage,
      totalPages,
      windowed: totalRepos > candidates.length,
      rubricVersion: SCORING_RUBRIC_VERSION,
      staleRubricOnPage: entries.filter((e) => !e.currentRubric).length,
    };
  }, null);
}

/**
 * The public scorecard for one owner: aggregated over that owner's PUBLIC repos in the PUBLIC org.
 *
 * This is deliberately a lens over the public corpus, NOT a view of the owner's Ascent tenant. It can
 * therefore publish nothing the per-repo report at `/report/{owner}/{repo}` doesn't already publish,
 * and it is structurally incapable of reaching a private repo or another tenant's org dashboard.
 *
 * Averages are computed over MODEL-SCORED repos only — a mock preview never moves the published
 * number. `verifiedCount === 0` means there is no number to publish, and callers must say so.
 */
export async function getPublicOrgScorecard(owner: string): Promise<PublicOrgScorecard | null> {
  if (!isDbConfigured()) return null;
  const prefix = owner.trim().toLowerCase();
  if (!prefix || prefix.includes("/")) return null;

  return dbReadSafe(async () => {
    const orgId = await resolveOrgId(DEFAULT_ORG_SLUG);
    if (!orgId) return null;
    const repos = await loadCandidates(orgId, prefix);
    if (repos.length === 0) return null;

    const scored = repos.filter((e) => e.verified);
    const mean = (pick: (e: RegisterEntry) => number) =>
      scored.length ? Math.round(scored.reduce((n, e) => n + pick(e), 0) / scored.length) : 0;

    const dimensions: Partial<Record<DimensionId, number>> = {};
    for (const e of scored) {
      for (const [dim, score] of Object.entries(e.dimensions)) {
        const id = dim as DimensionId;
        dimensions[id] = (dimensions[id] ?? 0) + (score ?? 0);
      }
    }
    for (const id of Object.keys(dimensions) as DimensionId[]) {
      dimensions[id] = Math.round((dimensions[id] ?? 0) / Math.max(1, scored.length));
    }

    const avgOverall = mean((e) => e.overall);
    const level = levelForScore(avgOverall);
    const scannedAt = repos.reduce<string | null>(
      (latest, e) => (latest && latest > e.scannedAt ? latest : e.scannedAt),
      null,
    );

    return {
      // Display casing from the rows, not the caller's URL segment.
      owner: repos[0]!.owner,
      avgOverall,
      avgAdoption: mean((e) => e.adoption),
      avgRigor: mean((e) => e.rigor),
      dimensions,
      level: level.id,
      levelName: level.name,
      repoCount: repos.length,
      verifiedCount: scored.length,
      scannedAt,
      repos,
      rubricVersion: SCORING_RUBRIC_VERSION,
      staleRubricCount: scored.filter((e) => !e.currentRubric).length,
    };
  }, null);
}
