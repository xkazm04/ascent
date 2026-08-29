// Retention compaction — a purged page of scans folds into a rubric-tagged `ScanDigest` inside the
// SAME transaction that deletes it, so retention stops being a choice between "keep every Scan row
// forever" and "delete the timeline that trends, forecasts and outcome deltas stand on".
//
// ── The three rules this module exists to hold ──────────────────────────────────────────────────
//
// 1. SUMS, NOT MEANS. A digest row is keyed (repoId, period, rubricVersion, engineProvider) and a
//    LATER purge tick folds more scans of the same period into the row an earlier tick wrote. Storing
//    `*Sum` + `scanCount` makes that merge EXACT and order-independent; a stored mean would drift the
//    moment two pages have unequal sizes (mean-of-means is not the mean). Means are derived on read.
//
// 2. THE `"unknown"` RUBRIC SENTINEL IS A CONSTRAINT ARTEFACT, NEVER A CLAIM. `Scan.rubricVersion` is
//    nullable (legacy rows predate the stamp), but Postgres treats NULLs as DISTINCT, so a nullable
//    key column would make every upsert insert a SECOND row instead of folding into the first. Legacy
//    scans therefore fold into the literal `"unknown"` — and `digestToPoint` maps it straight back to
//    `rubricVersion: null` on the wire, so `skill-outcomes.ts`'s `sameInstrument` keeps answering
//    `null` ("at least one side is silent") for those points. Silence about provenance stays silence.
//
// 3. UNKNOWN ≠ 0. A dimension absent from every scan in a period is ABSENT from `dimensionsJson`; the
//    reader emits no entry for it, so a dimension line renders a gap rather than a fabricated zero.
//
// Idempotency is atomicity, not bookkeeping: the fold is committed in the same `$transaction` as the
// `deleteMany` that removes its inputs (see `pruneRepoScans` in retention.ts), so a retried batch
// (DSQL OC###/40P01 via `withRetry`) rolls back BOTH halves and re-selects only surviving rows. No
// scan can be folded twice, and no scan can die without its fold.
//
// Compaction is OFF by default (`RETENTION_COMPACT` / `Organization.retentionCompact`): an existing
// deployment's purge is byte-for-byte what it was.

import type { Prisma } from "@prisma/client";
import { dbReadSafe, getPrisma, isDbConfigured, withRetry } from "@/lib/db/client";
import { envBool } from "@/lib/env";

/** The literal stored in `ScanDigest.rubricVersion` for scans that carry no rubric stamp. See rule 2. */
export const UNKNOWN_RUBRIC = "unknown";

/** `engineModel` reported for a digest that folded scans from more than one model. */
export const MIXED_ENGINE_MODEL = "mixed";

/** Preview cap: past this many stale scans a dry run reports `null` (unknown), never an estimate. */
export const DIGEST_PREVIEW_MAX_SCANS = 5000;

/** UTC month bucket, "YYYY-MM". UTC on purpose: a period boundary must not move with a viewer's zone. */
export function digestPeriod(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** One scan as the fold reads it — the columns `pruneRepoScans` widens its page select to. */
export interface DigestInputScan {
  id: string;
  scannedAt: Date;
  headSha: string | null;
  overallScore: number;
  adoptionScore: number;
  rigorScore: number;
  confidence: number;
  level: string;
  levelName: string;
  posture: string;
  /** Null for legacy scans — folded into {@link UNKNOWN_RUBRIC} for the key. */
  rubricVersion: string | null;
  engineProvider: string;
  engineModel: string;
  dimensions: { dimId: string; score: number; signalScore: number; llmScore: number }[];
  recsOpened: number;
  recsClosed: number;
}

/** Per-dimension fold. `n` is how many scans in the period actually CARRIED the dimension. */
export interface DigestDimFold {
  sum: number;
  n: number;
  last: number;
  signalSum: number;
  llmSum: number;
}

/** The fold of one page of scans, for one (period, rubricVersion, engineProvider) key. */
export interface DigestDraft {
  key: { period: string; rubricVersion: string; engineProvider: string };
  scanCount: number;
  overallSum: number;
  adoptionSum: number;
  rigorSum: number;
  overallMin: number;
  overallMax: number;
  overallLast: number;
  adoptionLast: number;
  rigorLast: number;
  confidenceSum: number;
  levelLast: string;
  levelNameLast: string;
  postureLast: string;
  firstScannedAt: Date;
  lastScannedAt: Date;
  firstHeadSha: string | null;
  lastHeadSha: string | null;
  engines: string[];
  dimensions: Record<string, DigestDimFold>;
  recsOpened: number;
  recsClosed: number;
}

/**
 * A stored digest, read back. Timestamps are ISO **strings** (the wire-safe-dates convention — this
 * type reaches a client through `CompactedPoint`), and the two TEXT JSON columns arrive parsed.
 */
export interface ScanDigestRow {
  id: string;
  repoId: string;
  period: string;
  /** Non-null by construction; `"unknown"` for legacy scans (rule 2). Never rendered as knowledge. */
  rubricVersion: string;
  engineProvider: string;
  scanCount: number;
  overallSum: number;
  adoptionSum: number;
  rigorSum: number;
  overallMin: number;
  overallMax: number;
  overallLast: number;
  adoptionLast: number;
  rigorLast: number;
  confidenceSum: number;
  levelLast: string;
  levelNameLast: string;
  postureLast: string;
  firstScannedAt: string;
  lastScannedAt: string;
  firstHeadSha: string | null;
  lastHeadSha: string | null;
  engines: string[];
  dimensions: Record<string, DigestDimFold>;
  recsOpened: number;
  recsClosed: number;
}

/** The column payload written for a digest row (Prisma-shaped: real `Date`s, TEXT JSON strings). */
export interface ScanDigestWrite {
  period: string;
  rubricVersion: string;
  engineProvider: string;
  scanCount: number;
  overallSum: number;
  adoptionSum: number;
  rigorSum: number;
  overallMin: number;
  overallMax: number;
  overallLast: number;
  adoptionLast: number;
  rigorLast: number;
  confidenceSum: number;
  levelLast: string;
  levelNameLast: string;
  postureLast: string;
  firstScannedAt: Date;
  lastScannedAt: Date;
  firstHeadSha: string | null;
  lastHeadSha: string | null;
  enginesJson: string;
  dimensionsJson: string;
  recsOpened: number;
  recsClosed: number;
}

/**
 * A compacted history point — one period's summary, served in the same ordered series as real scans
 * and visibly labelled as a summary.
 *
 * `headSha` is **null** even though the digest stores `lastHeadSha`: the `Scan` row is gone, so a
 * report permalink built from it would 404. `id` is `digest:<row.id>` so it can never be mistaken for
 * (or fetched as) a scan id. Together those two are what make a compacted point non-navigable in the
 * two consumers that derive links from `headSha`, with no change to their link logic.
 */
export interface CompactedPoint {
  id: string;
  compacted: true;
  headSha: null;
  /** The period MEAN, rounded once here (the render boundary never re-rounds a re-derived mean). */
  overallScore: number;
  level: string;
  levelName: string;
  confidence: number;
  engineProvider: string;
  /** The single model that scored the period, or `"mixed"` when more than one did. */
  engineModel: string;
  /** `null` for the `"unknown"` sentinel — the sentinel never leaks as knowledge (rule 2). */
  rubricVersion: string | null;
  /** The period's LAST scan time, so the point sorts into the series where its newest input sat. */
  scannedAt: string;
  /** How many scans this one point summarises. Absent on a real scan point. */
  scanCount: number;
  dimensions: { dimId: string; score: number }[];
}

// ── The pure fold (clock-free, dependency-free — the unit-test surface) ─────────────────────────

/** Fold one page of scans into one draft per (period, rubricVersion, engineProvider). */
export function digestScans(rows: readonly DigestInputScan[]): DigestDraft[] {
  const byKey = new Map<string, DigestDraft>();
  // Fold in chronological order so "last" means last, regardless of the page's selection order (the
  // prune pages by `createdAt desc`). Sorting a copy keeps the function pure.
  const ordered = [...rows].sort((a, b) => a.scannedAt.getTime() - b.scannedAt.getTime());
  for (const s of ordered) {
    const period = digestPeriod(s.scannedAt);
    const rubricVersion = s.rubricVersion ?? UNKNOWN_RUBRIC;
    const k = `${period} ${rubricVersion} ${s.engineProvider}`;
    const d = byKey.get(k);
    if (!d) {
      byKey.set(k, {
        key: { period, rubricVersion, engineProvider: s.engineProvider },
        scanCount: 1,
        overallSum: s.overallScore,
        adoptionSum: s.adoptionScore,
        rigorSum: s.rigorScore,
        overallMin: s.overallScore,
        overallMax: s.overallScore,
        overallLast: s.overallScore,
        adoptionLast: s.adoptionScore,
        rigorLast: s.rigorScore,
        confidenceSum: s.confidence,
        levelLast: s.level,
        levelNameLast: s.levelName,
        postureLast: s.posture,
        firstScannedAt: s.scannedAt,
        lastScannedAt: s.scannedAt,
        firstHeadSha: s.headSha,
        lastHeadSha: s.headSha,
        engines: [s.engineModel],
        dimensions: foldDimensions({}, s.dimensions),
        recsOpened: s.recsOpened,
        recsClosed: s.recsClosed,
      });
      continue;
    }
    d.scanCount += 1;
    d.overallSum += s.overallScore;
    d.adoptionSum += s.adoptionScore;
    d.rigorSum += s.rigorScore;
    d.overallMin = Math.min(d.overallMin, s.overallScore);
    d.overallMax = Math.max(d.overallMax, s.overallScore);
    d.confidenceSum += s.confidence;
    d.recsOpened += s.recsOpened;
    d.recsClosed += s.recsClosed;
    if (!d.engines.includes(s.engineModel)) d.engines.push(s.engineModel);
    // `*Last` advances only forward; `first*` only retreats. Ties keep the earlier-seen value, which
    // is the chronological one because the page was sorted above.
    if (s.scannedAt.getTime() > d.lastScannedAt.getTime()) {
      d.lastScannedAt = s.scannedAt;
      d.lastHeadSha = s.headSha;
      d.overallLast = s.overallScore;
      d.adoptionLast = s.adoptionScore;
      d.rigorLast = s.rigorScore;
      d.levelLast = s.level;
      d.levelNameLast = s.levelName;
      d.postureLast = s.posture;
    }
    if (s.scannedAt.getTime() < d.firstScannedAt.getTime()) {
      d.firstScannedAt = s.scannedAt;
      d.firstHeadSha = s.headSha;
    }
    d.dimensions = foldDimensions(d.dimensions, s.dimensions);
  }
  return [...byKey.values()];
}

/** Fold one scan's dimension rows into the accumulator. Absent dimensions stay absent (rule 3). */
function foldDimensions(
  acc: Record<string, DigestDimFold>,
  dims: readonly { dimId: string; score: number; signalScore: number; llmScore: number }[],
): Record<string, DigestDimFold> {
  const out: Record<string, DigestDimFold> = { ...acc };
  for (const dim of dims) {
    const e = out[dim.dimId];
    out[dim.dimId] = e
      ? {
          sum: e.sum + dim.score,
          n: e.n + 1,
          last: dim.score,
          signalSum: e.signalSum + dim.signalScore,
          llmSum: e.llmSum + dim.llmScore,
        }
      : { sum: dim.score, n: 1, last: dim.score, signalSum: dim.signalScore, llmSum: dim.llmScore };
  }
  return out;
}

/**
 * Merge a draft into the row already stored for its key (or `null` for the first fold of that key).
 *
 * EXACT by construction: every accumulator is a sum, a min/max, or a first/last governed by the
 * timestamp — so folding page A then page B gives the same row as folding B then A, and the same row
 * as folding A∪B in one go. That is the property a mean-of-means implementation loses.
 */
export function mergeDigest(existing: ScanDigestRow | null, draft: DigestDraft): ScanDigestWrite {
  if (!existing) {
    return {
      period: draft.key.period,
      rubricVersion: draft.key.rubricVersion,
      engineProvider: draft.key.engineProvider,
      scanCount: draft.scanCount,
      overallSum: draft.overallSum,
      adoptionSum: draft.adoptionSum,
      rigorSum: draft.rigorSum,
      overallMin: draft.overallMin,
      overallMax: draft.overallMax,
      overallLast: draft.overallLast,
      adoptionLast: draft.adoptionLast,
      rigorLast: draft.rigorLast,
      confidenceSum: draft.confidenceSum,
      levelLast: draft.levelLast,
      levelNameLast: draft.levelNameLast,
      postureLast: draft.postureLast,
      firstScannedAt: draft.firstScannedAt,
      lastScannedAt: draft.lastScannedAt,
      firstHeadSha: draft.firstHeadSha,
      lastHeadSha: draft.lastHeadSha,
      enginesJson: JSON.stringify(draft.engines),
      dimensionsJson: JSON.stringify(draft.dimensions),
      recsOpened: draft.recsOpened,
      recsClosed: draft.recsClosed,
    };
  }
  const prevLast = Date.parse(existing.lastScannedAt);
  const prevFirst = Date.parse(existing.firstScannedAt);
  const draftIsNewer = draft.lastScannedAt.getTime() > prevLast;
  const draftIsOlder = draft.firstScannedAt.getTime() < prevFirst;
  const engines = [...existing.engines];
  for (const m of draft.engines) if (!engines.includes(m)) engines.push(m);
  const dimensions: Record<string, DigestDimFold> = { ...existing.dimensions };
  for (const [dimId, f] of Object.entries(draft.dimensions)) {
    const e = dimensions[dimId];
    dimensions[dimId] = e
      ? {
          sum: e.sum + f.sum,
          n: e.n + f.n,
          // `last` follows the newer HALF of the merge, not the newer fold of the dimension: the two
          // halves are disjoint scan sets, so whichever half holds the period's newest scan holds the
          // newest reading of every dimension it carries.
          last: draftIsNewer ? f.last : e.last,
          signalSum: e.signalSum + f.signalSum,
          llmSum: e.llmSum + f.llmSum,
        }
      : f;
  }
  return {
    period: existing.period,
    rubricVersion: existing.rubricVersion,
    engineProvider: existing.engineProvider,
    scanCount: existing.scanCount + draft.scanCount,
    overallSum: existing.overallSum + draft.overallSum,
    adoptionSum: existing.adoptionSum + draft.adoptionSum,
    rigorSum: existing.rigorSum + draft.rigorSum,
    overallMin: Math.min(existing.overallMin, draft.overallMin),
    overallMax: Math.max(existing.overallMax, draft.overallMax),
    overallLast: draftIsNewer ? draft.overallLast : existing.overallLast,
    adoptionLast: draftIsNewer ? draft.adoptionLast : existing.adoptionLast,
    rigorLast: draftIsNewer ? draft.rigorLast : existing.rigorLast,
    confidenceSum: existing.confidenceSum + draft.confidenceSum,
    levelLast: draftIsNewer ? draft.levelLast : existing.levelLast,
    levelNameLast: draftIsNewer ? draft.levelNameLast : existing.levelNameLast,
    postureLast: draftIsNewer ? draft.postureLast : existing.postureLast,
    firstScannedAt: draftIsOlder ? draft.firstScannedAt : new Date(prevFirst),
    lastScannedAt: draftIsNewer ? draft.lastScannedAt : new Date(prevLast),
    firstHeadSha: draftIsOlder ? draft.firstHeadSha : existing.firstHeadSha,
    lastHeadSha: draftIsNewer ? draft.lastHeadSha : existing.lastHeadSha,
    enginesJson: JSON.stringify(engines),
    dimensionsJson: JSON.stringify(dimensions),
    recsOpened: existing.recsOpened + draft.recsOpened,
    recsClosed: existing.recsClosed + draft.recsClosed,
  };
}

/** Map a stored digest to the wire point readers serve. Pure — see {@link CompactedPoint}'s notes. */
export function digestToPoint(row: ScanDigestRow): CompactedPoint {
  const n = Math.max(1, row.scanCount);
  return {
    id: `digest:${row.id}`,
    compacted: true,
    headSha: null,
    overallScore: Math.round(row.overallSum / n),
    level: row.levelLast,
    levelName: row.levelNameLast,
    confidence: row.confidenceSum / n,
    engineProvider: row.engineProvider,
    engineModel: row.engines.length > 1 ? MIXED_ENGINE_MODEL : (row.engines[0] ?? MIXED_ENGINE_MODEL),
    rubricVersion: row.rubricVersion === UNKNOWN_RUBRIC ? null : row.rubricVersion,
    scannedAt: row.lastScannedAt,
    scanCount: row.scanCount,
    // Per-dimension MEAN over the scans that actually carried the dimension. A dimension no scan in
    // the period carried has no entry here at all — never a zero (rule 3).
    dimensions: Object.entries(row.dimensions)
      .filter(([, f]) => f.n > 0)
      .map(([dimId, f]) => ({ dimId, score: Math.round(f.sum / f.n) })),
  };
}

// ── Configuration ──────────────────────────────────────────────────────────────────────────────
// Not an escape hatch: compaction is a retention mechanic that a real deployment legitimately turns
// on in production, so there is no NODE_ENV floor here (contrast `authBypassEnabled` in lib/env.ts).

/** Effective compaction settings for an org. `digestMonths === 0` keeps digests forever. */
export interface CompactionPolicy {
  compact: boolean;
  digestMonths: number;
}

/** Resolve `RETENTION_COMPACT` / `RETENTION_DIGEST_MONTHS` against the org's overrides (null = inherit). */
export function resolveCompaction(org: {
  retentionCompact: boolean | null;
  retentionDigestMonths: number | null;
}): CompactionPolicy {
  const envMonths = Number(process.env.RETENTION_DIGEST_MONTHS);
  return {
    compact: org.retentionCompact ?? envBool("RETENTION_COMPACT"),
    digestMonths: org.retentionDigestMonths ?? (Number.isFinite(envMonths) && envMonths >= 0 ? Math.floor(envMonths) : 0),
  };
}

/** `d` moved back `months` whole months, in UTC — the digest-retention cutoff. */
export function monthsBefore(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  out.setUTCMonth(out.getUTCMonth() - months);
  return out;
}

// ── Persistence ────────────────────────────────────────────────────────────────────────────────

type PrismaLike = ReturnType<typeof getPrisma>;
/** The narrow slice of a transaction client this module uses (so a test can hand in a fake). */
type DigestTx = Pick<Prisma.TransactionClient, "scanDigest">;

/** Parse the two TEXT JSON columns defensively — a corrupt cell degrades to empty, never throws. */
function parseJson<T>(raw: string, fallback: T): T {
  try {
    const v: unknown = JSON.parse(raw);
    return v == null ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

/** Map a Prisma `ScanDigest` row to the wire-safe {@link ScanDigestRow}. */
export function toDigestRow(row: {
  id: string;
  repoId: string;
  period: string;
  rubricVersion: string;
  engineProvider: string;
  scanCount: number;
  overallSum: number;
  adoptionSum: number;
  rigorSum: number;
  overallMin: number;
  overallMax: number;
  overallLast: number;
  adoptionLast: number;
  rigorLast: number;
  confidenceSum: number;
  levelLast: string;
  levelNameLast: string;
  postureLast: string;
  firstScannedAt: Date;
  lastScannedAt: Date;
  firstHeadSha: string | null;
  lastHeadSha: string | null;
  enginesJson: string;
  dimensionsJson: string;
  recsOpened: number;
  recsClosed: number;
}): ScanDigestRow {
  return {
    ...row,
    firstScannedAt: row.firstScannedAt.toISOString(),
    lastScannedAt: row.lastScannedAt.toISOString(),
    engines: parseJson<string[]>(row.enginesJson, []),
    dimensions: parseJson<Record<string, DigestDimFold>>(row.dimensionsJson, {}),
  };
}

/**
 * Write the drafts for one purge page, INSIDE the caller's transaction.
 *
 * Read-then-merge-then-write rather than a bare Prisma `upsert`, because the merge is arithmetic over
 * the row that is already there (rule 1) — there is no `upsert` shape that expresses "add these sums
 * and advance these lasts". The read and the write share the caller's transaction, and the caller
 * commits them with the `deleteMany` that removes the folded scans, so a conflict retry re-reads.
 *
 * Returns the number of digest rows created or updated.
 */
export async function upsertDigests(tx: DigestTx, repoId: string, drafts: readonly DigestDraft[]): Promise<number> {
  let written = 0;
  for (const draft of drafts) {
    const where = {
      repoId_period_rubricVersion_engineProvider: {
        repoId,
        period: draft.key.period,
        rubricVersion: draft.key.rubricVersion,
        engineProvider: draft.key.engineProvider,
      },
    };
    const found = await tx.scanDigest.findUnique({ where });
    const data = mergeDigest(found ? toDigestRow(found) : null, draft);
    if (found) await tx.scanDigest.update({ where: { id: found.id }, data });
    else await tx.scanDigest.create({ data: { ...data, repoId } });
    written++;
  }
  return written;
}

/**
 * The compacted tail for one repo: digests whose newest input predates `before` (the oldest RETAINED
 * scan), newest first. The `before` boundary is what stops a period that straddles the retention
 * horizon from being counted twice — once as real scans, once as a summary of the same scans.
 */
export async function readDigestTail(
  repoId: string,
  opts: { before?: Date; limit: number },
): Promise<ScanDigestRow[]> {
  if (!isDbConfigured()) return [];
  const limit = Math.max(0, Math.trunc(opts.limit));
  if (limit === 0) return [];
  const prisma = getPrisma();
  const rows = await prisma.scanDigest.findMany({
    where: { repoId, ...(opts.before ? { lastScannedAt: { lt: opts.before } } : {}) },
    orderBy: [{ lastScannedAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return rows.map(toDigestRow);
}

/**
 * Age digests out past `cutoff`, batched and budget-polled like every other loop in retention.ts.
 * Callers pass no cutoff at all when `digestMonths === 0` (keep forever) — this function never
 * encodes that sentinel itself, so "0 = forever" lives in exactly one place (the caller's policy).
 */
export async function pruneDigests(
  prisma: PrismaLike,
  repoId: string,
  cutoff: Date,
  batchSize: number,
  budgetExceeded?: () => boolean,
): Promise<number> {
  let total = 0;
  for (;;) {
    if (budgetExceeded?.()) break;
    const page = await prisma.scanDigest.findMany({
      where: { repoId, lastScannedAt: { lt: cutoff } },
      orderBy: { lastScannedAt: "asc" },
      take: batchSize,
      select: { id: true },
    });
    if (page.length === 0) break;
    const ids = page.map((r) => r.id);
    const count = (
      await withRetry(() => prisma.scanDigest.deleteMany({ where: { id: { in: ids } } }), {
        label: "retention.prune-digests",
      })
    ).count;
    total += count;
    if (count === 0 || page.length < batchSize) break;
  }
  return total;
}

/** How far an org's compacted tail reaches beyond what its retained scans still cover. */
export interface CompactionCoverage {
  /** Repos with at least one digest row. */
  repos: number;
  /** Digest rows across the org. */
  digests: number;
  /** Scans those digests summarise (the sum of `scanCount`) — history that would otherwise be gone. */
  scansCompacted: number;
  /** Oldest period any digest covers ("YYYY-MM"), or null when there are none. */
  oldestPeriod: string | null;
  /** Days between the oldest digest and the oldest RETAINED scan — the span compaction adds back.
   *  Null (not 0) when either end is unknown: an unmeasured span is not a zero-length one. */
  extraSpanDays: number | null;
}

const DAY_MS = 86_400_000;

/**
 * Org-level compaction coverage, for the briefing's "timeline extends N months beyond retained
 * scans" clause (#26 / W2-G calls this; the wording is that lane's).
 *
 * Degrades to `null` through `dbReadSafe` like every other reader here — never to zeros, which would
 * read as "compaction is on and covering nothing" rather than "we could not tell".
 */
export async function getCompactionCoverage(orgSlug: string): Promise<CompactionCoverage | null> {
  if (!isDbConfigured()) return null;
  return dbReadSafe(async () => {
    const prisma = getPrisma();
    const org = await prisma.organization.findUnique({
      where: { slug: orgSlug.trim().toLowerCase() },
      select: { id: true },
    });
    if (!org) return null;
    const where = { repo: { orgId: org.id } };
    const agg = await prisma.scanDigest.aggregate({
      where,
      _count: { _all: true },
      _sum: { scanCount: true },
      _min: { period: true, firstScannedAt: true },
    });
    const digests = agg._count._all;
    if (digests === 0) {
      return { repos: 0, digests: 0, scansCompacted: 0, oldestPeriod: null, extraSpanDays: null };
    }
    const repoRows = await prisma.scanDigest.groupBy({ by: ["repoId"], where });
    const oldestDigest = agg._min.firstScannedAt;
    const oldestScan = await prisma.scan.findFirst({
      where: { repo: { orgId: org.id } },
      orderBy: { scannedAt: "asc" },
      select: { scannedAt: true },
    });
    // Honest null: with no retained scan there is no "beyond" to measure against, and with no digest
    // start there is nothing to measure. Neither case is a zero-day extension.
    const extraSpanDays =
      oldestDigest && oldestScan
        ? Math.max(0, Math.round((oldestScan.scannedAt.getTime() - oldestDigest.getTime()) / DAY_MS))
        : null;
    return {
      repos: repoRows.length,
      digests,
      scansCompacted: agg._sum.scanCount ?? 0,
      oldestPeriod: agg._min.period ?? null,
      extraSpanDays,
    };
  }, null);
}
