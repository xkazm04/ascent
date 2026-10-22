// The public scan gallery (landing-page discovery): the live "recently scanned" rail and the landing
// register ("most AI-native"), plus the /about live fleet that reads the same cards. Relocated from
// db/scans-read.ts (card portfolio-0), which re-exports it so every import path is unchanged. It stays
// inside the data layer (the raw client is data-layer internal) and reads the rules from the door.
//
// This is the SECOND public ranking over the corpus /leaderboard reads (register/data.ts), and it now
// holds the same two invariants through the same door (register/corpus.ts):
//
//  1. TENANCY. Every query spreads publicCorpusWhere (the PUBLIC org AND isPrivate:false), the id-keyed
//     extra fetch re-asserts it, and galleryCardFrom refuses a private row per row. It used to do
//     none of the last two: the extra fetch was id-only and the select did not even carry isPrivate.
//  2. PROVENANCE. A card carries `verified` from isRankableScan, and topAiNative ranks verified cards
//     only, with the one byRank comparator. A mock floor stays visible in `recent` (labelled `demo`)
//     but never wears a board position on the surface titled "The register".

import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";
import { getDbMode, type DbMode } from "@/lib/db/mode";
import { DEFAULT_ORG_SLUG, resolveOrgId } from "@/lib/db/scans-shared";
import { SCORING_RUBRIC_VERSION, isDimensionId } from "@/lib/maturity/model";
import { reportPermalink } from "@/lib/ui";
import type { DimensionId } from "@/lib/types";
import { RANKABLE_ENGINE_WHERE, byRank, isRankableScan, publicCorpusWhere, publicRowOrNull } from "@/lib/register/corpus";

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
  /** Per-dimension scores (D1..D9) from this scan - powers the register's per-dimension columns.
   *  Partial: a dimension a partial scan didn't persist is simply absent. */
  dimensions: Partial<Record<DimensionId, number>>;
  posture: string; // posture id (ai-native | ungoverned | manual | early)
  primaryLanguage: string | null;
  stars: number;
  scannedAt: string; // ISO
  /** Permalink to the pinned report (commit-pinned when the scan recorded a head SHA). */
  href: string;
  /** The rubric this score was computed under ("r15"), or null on a row scored before the column. */
  rubricVersion: string | null;
  /** True only when the score was taken with the rubric in force NOW. A null version is UNKNOWN and
   *  therefore NOT current - the same reading `db/outcomes.ts` and `register/data.ts` give it.
   *
   *  MC-B18 gave `RegisterEntry` (/leaderboard) this pair; the landing register is a SECOND public
   *  ranking over the same corpus and was left un-qualified (MC-B42). Derived here, at the same point
   *  the row is projected, so both surfaces say the same thing in the same words. Computed inside the
   *  60 s cache window, so a rubric bump takes at most one revalidation to show - the bump itself does
   *  NOT re-scan anything, which is the whole reason the qualifier has to exist. */
  currentRubric: boolean;
  /** False when the score came from the deterministic mock rubric (or an unknown engine): a preview,
   *  never ranked. Same rule (corpus.ts isRankableScan) as RegisterEntry.verified on /leaderboard. */
  verified: boolean;
  /** The archetype lens this scan was weighted under ("solo" | "team" | "org"), passed through as
   *  stored: weightsFor falls back to the org lens for an unknown id. Lets /about recompute a public
   *  repo with the engine's own weighting (projectedGain) instead of a demo constant. */
  archetype: string;
}

export interface PublicScanGallery {
  /** Latest scan per repo, most recently scanned first. */
  recent: PublicRepoCard[];
  /** Latest scan per repo, VERIFIED cards only, in the register's byRank order (a mock floor is never
   *  ranked here; it can still appear, labelled, in `recent`). */
  topAiNative: PublicRepoCard[];
  /** Distinct public repos with at least one scan - the size of the public corpus. */
  totalRepos: number;
  /** Which database backend served this gallery - drives the "served live from Aurora DSQL"
   *  indicator on the landing register, so the AWS database in use is visible on screen. */
  dbMode: DbMode;
}

// Upper bound on the candidate repos EACH gallery rail materializes. The page shows only ~12 + ~8
// cards, but the two rails are ranked DIFFERENTLY (recency vs score), so they need two independent
// bounded candidate windows - see loadPublicGalleryCards. Reusing a single recency-capped window for
// both made the leaderboard silently mean "top within the recently-touched N" once the public corpus
// grew past the cap: a genuinely high-scoring repo that hadn't been re-scanned lately fell outside it.
const GALLERY_CANDIDATE_CAP = 200;

// Repository projection shared by both candidate windows so the two queries stay byte-identical and the
// card builder sees one type. `id` backs the cross-window dedup; the nested `scans` pick is the latest
// scan per repo (tie-broken beyond bare scannedAt - see scans-persist - so it's deterministic on a tie).
const GALLERY_REPO_SELECT = Prisma.validator<Prisma.RepositorySelect>()({
  id: true,
  owner: true,
  name: true,
  fullName: true,
  // Selected so galleryCardFrom can refuse a private row per row (tenancy, invariant 1).
  isPrivate: true,
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
      engineProvider: true,
      scannedAt: true,
      rubricVersion: true,
      archetype: true,
      dimensions: { select: { dimId: true, score: true } },
    },
  },
});

type GalleryRepoRow = Prisma.RepositoryGetPayload<{ select: typeof GALLERY_REPO_SELECT }>;

/** Project a repo + its latest scan into a gallery card; null when the repo has no scan row.
 *  Exported for the provenance unit tests (`scans-gallery.test.ts`) - the rubric derivation is the
 *  one thing on this path that must not drift from `register/data.ts`. */
export function galleryCardFrom(r: GalleryRepoRow): PublicRepoCard | null {
  if (!publicRowOrNull(r)) return null; // never publish a private repo, whatever the query returned
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
    rubricVersion: s.rubricVersion,
    // Never `!= current`: a null column is unknown, and unknown is not current.
    currentRubric: s.rubricVersion === SCORING_RUBRIC_VERSION,
    archetype: s.archetype,
    verified: isRankableScan(s.engineProvider),
  };
}

/**
 * The DB-derived half of the public scan gallery, cached across requests with `unstable_cache`. The
 * landing page is the hottest route and `force-dynamic`, so without this each hit re-ran the corpus
 * query (and the codebase has no other data cache). The data is session-independent, so a short shared
 * TTL turns N homepage renders into one DB pass per window. `orgId` is resolved by the caller and passed
 * in - no request-scoped read runs inside the cache scope - and is part of the cache key. The returned
 * shape is fully serializable (scannedAt is pre-stringified).
 */
const loadPublicGalleryCards = unstable_cache(
  async (
    orgId: string,
    recentLimit: number,
    topLimit: number,
  ): Promise<{ recent: PublicRepoCard[]; topAiNative: PublicRepoCard[]; totalRepos: number } | null> => {
    const prisma = getPrisma();
    const where = { ...publicCorpusWhere(orgId), scans: { some: {} } } as const;

    // Two INDEPENDENT candidate windows, one per rail (a single recency-capped window can't serve both):
    //  - recency rail: the CAP most-recently-active repos. `updatedAt` bumps on every scan upsert, and a
    //    public repo is only ever mutated by scanning, so ordering by it ≈ "most recently scanned".
    //  - leaderboard: the CAP highest-scoring public SCANS, reduced to their repos - so a high-scoring
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
        // Rankable scans only: a window over every scan let mock floors crowd the model scores out of it.
        where: { repo: publicCorpusWhere(orgId), ...RANKABLE_ENGINE_WHERE },
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
      ? await prisma.repository.findMany({
          // Tenancy re-asserted on the id-keyed fetch: an id list is never proof of tenancy.
          where: { id: { in: extraIds }, ...publicCorpusWhere(orgId) },
          select: GALLERY_REPO_SELECT,
        })
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
    // Verified cards only, in /leaderboard's order: a mock floor is a preview, not a rating.
    const topAiNative = cards
      .filter((c) => c.verified)
      .sort(byRank)
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

  // A configured-but-UNREACHABLE DB must degrade to the static fallback (null → the landing page renders
  // its static examples), NOT 500 the public homepage. resolveOrgId + the cached corpus load both issue
  // raw getPrisma() reads that throw PrismaClientInitializationError on a DB-down; dbReadSafe returns null
  // on that (and recovers a DSQL auth-expiry with one reconnect + retry), exactly as getHeadHint /
  // getRepoPassport already do. A genuine live-DB query error still propagates. (scan-persistence-history #2)
  return dbReadSafe(async () => {
    // Resolve the public org id OUTSIDE the cache scope (unstable_cache must not wrap request-scoped reads).
    const orgId = await resolveOrgId(DEFAULT_ORG_SLUG);
    if (!orgId) return null;

    const data = await loadPublicGalleryCards(orgId, recentLimit, topLimit);
    if (!data) return null;
    // dbMode reflects the live backend (env/global signals), not cached row data - merge it in per request.
    return { ...data, dbMode: getDbMode() };
  }, null);
}