// Persistence for scan reports + history/audit queries. Every function is a no-op or
// safe fallback when the DB isn't configured, so callers can wire these in freely
// without breaking the DB-less MVP.

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
  RecEvent,
  RecEventKind,
  RecStatus,
  RepoArchetype,
  ScanReport,
} from "@/lib/types";
import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured, withRetry } from "@/lib/db/client";
import { cacheDelete, makeCacheKey } from "@/lib/cache";
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
  /** Per-area write failures. Persistence is now atomic — the scan graph, contributor upserts, and
   *  the audit entry commit in one transaction — so a returned result means everything was written:
   *  these stay at no-failure on success, and a partial failure surfaces as a thrown error (the
   *  whole scan rolls back) instead. Retained for backward compatibility with callers that still
   *  inspect them. */
  failures: { audit: boolean; contributors: number };
}

// ── Concurrency safety for persistScanReport ───────────────────────────────────────────────
// Two concurrent scans of the same repo (a double-click, a cron rescan batch) used to race: the
// org/repo upserts could collide on a unique constraint and throw, and the carry-forward read +
// scan insert could interleave so both scans read the same "previous" snapshot and both insert.
// These three helpers make the persist path race-safe — see persistScanReport. Exported for unit
// testing (mirrors the helper exports in db/client.ts).

/** True for Prisma's P2002 unique-constraint violation — the error a lost insert race throws. */
export function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Run an upsert that may lose a create race. Aurora DSQL's optimistic concurrency (and a plain
 * Postgres find-then-create) lets two callers both miss the existing row and both attempt the
 * insert; the loser gets a P2002 instead of the row. On P2002 we recover via `onConflict` — read
 * the row the winner just created — rather than letting an unhandled 500 escape. Any other error
 * propagates untouched.
 */
export async function upsertRacing<T>(
  upsert: () => Promise<T>,
  onConflict: () => Promise<T>,
): Promise<T> {
  try {
    return await upsert();
  } catch (err) {
    if (isUniqueConstraintError(err)) return onConflict();
    throw err;
  }
}

// Process-local cache of org id by slug. The shared 'public' org backs EVERY anonymous scan, so
// re-upserting it on each scan made concurrent scans contend on a single hot Organization row — and
// on Aurora DSQL (optimistic concurrency, no row locks) those colliding commits are rejected with a
// retryable serialization conflict, which previously surfaced as failed 500s with no scan saved. We
// instead resolve the org once per process and cache the id (org ids are immutable), so the hot-row
// write disappears entirely after the first resolution. See ensureOrgId.
//
// The cache periodically re-confirms the row still exists: relationMode="prisma" emits NO foreign
// keys, so if an org is deleted (retention purge, manual cleanup, re-seed with a new id) while an
// instance holds the stale id, writes would silently orphan Scan/Repository/AuditLog rows with no
// DB error. A bounded PK re-check (read, not the hot-row write) closes that window.
const ORG_REVERIFY_MS = 5 * 60 * 1000;
const orgIdCache = new Map<string, { id: string; verifiedAt: number }>();

/**
 * Drop a cached org-id resolution so the next `ensureOrgId` re-resolves from the DB. Call this from
 * any path that deletes or replaces an organization, so a stale cached id can't keep routing fresh
 * Scan/Repository/AuditLog writes at a row that no longer exists. With no argument, clears the whole
 * cache. Safe to call when persistence is off (the cache is simply empty).
 */
export function invalidateOrgIdCache(orgSlug?: string): void {
  if (orgSlug) orgIdCache.delete(orgSlug);
  else orgIdCache.clear();
}

/**
 * Resolve an org slug to its id, creating the org at most once per process and caching the result —
 * so a scan no longer writes the shared 'public' Organization row on every call (the hot-row OCC
 * conflict described above). Read-first: once the row exists (it's seeded in prisma/init.sql for
 * local dev, and created at most once here otherwise) this is a pure read, then a cached hit on
 * every later scan. A concurrent first-create race is resolved via upsertRacing (P2002 → re-read),
 * and a serialization conflict on the create is retried via withRetry. Process-local + best-effort;
 * a fresh instance simply re-resolves on its first scan.
 */
async function ensureOrgId(orgSlug: string): Promise<string> {
  const prisma = getPrisma();
  const cached = orgIdCache.get(orgSlug);
  if (cached) {
    // Org ids are immutable, so within the re-verify window the cached id is trusted outright. Past
    // it, confirm the row still exists with a cheap PK read (not the hot-row write the cache removed)
    // before reusing it — so a deleted/replaced org can't keep orphaning writes at a dangling id. On
    // a miss, drop the entry and fall through to re-resolve (which recreates the org if needed).
    if (Date.now() - cached.verifiedAt < ORG_REVERIFY_MS) return cached.id;
    const stillThere = await prisma.organization.findUnique({
      where: { id: cached.id },
      select: { id: true },
    });
    if (stillThere) {
      cached.verifiedAt = Date.now();
      return cached.id;
    }
    orgIdCache.delete(orgSlug);
  }
  const name = orgSlug === DEFAULT_ORG_SLUG ? "Public Scans" : orgSlug;
  const id = await withRetry(
    () =>
      upsertRacing(
        async () => {
          const existing = await prisma.organization.findUnique({
            where: { slug: orgSlug },
            select: { id: true },
          });
          if (existing) return existing.id;
          const created = await prisma.organization.create({
            data: { slug: orgSlug, name },
            select: { id: true },
          });
          return created.id;
        },
        // Lost the first-create race: read the row the winner just created.
        async () => {
          const row = await prisma.organization.findUnique({
            where: { slug: orgSlug },
            select: { id: true },
          });
          if (!row) throw new Error(`[db] organization "${orgSlug}" missing after a unique conflict`);
          return row.id;
        },
      ),
    { label: "persistScanReport:org" },
  );
  orgIdCache.set(orgSlug, { id, verifiedAt: Date.now() });
  return id;
}

// Per-repo serialization queue (process-local). Keyed by repo id; each key holds a promise chain so
// same-repo persists run one at a time, in arrival order.
const repoPersistQueue = new Map<string, Promise<unknown>>();

/**
 * Serialize `fn` against other calls with the same `key`, in arrival order. Same-key runs never
 * overlap (so the dedup + carry-forward reads see a stable snapshot instead of racing a sibling's
 * insert); different keys run concurrently. Best-effort and process-local — it collapses the common
 * same-instance race (double-click, cron batch), while genuine cross-instance races still fall back
 * to commit-SHA dedup and the atomic transaction. A failed run never wedges the queue for its key.
 */
export function withRepoLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = repoPersistQueue.get(key) ?? Promise.resolve();
  const result = prev.then(fn);
  // Track a non-rejecting tail so one failed run can't break the chain for later callers, and evict
  // the key once this is the last queued run so the map can't grow without bound.
  const tail = result.then(
    () => {},
    () => {},
  );
  repoPersistQueue.set(key, tail);
  void tail.then(() => {
    if (repoPersistQueue.get(key) === tail) repoPersistQueue.delete(key);
  });
  return result;
}

/**
 * Persist a scan report (org -> repository -> scan -> dimensions + recommendations) and
 * write an audit entry. Returns a PersistResult, or null if persistence is disabled.
 *
 * Deduplicates by commit SHA: if a scan for this repo at the same HEAD already exists,
 * it is reused and NO new row is written — avoiding redundant LLM persistence and a
 * second usage-based charge for an unchanged commit (`deduped: true`).
 *
 * Race-safe, retry-safe, and atomic:
 *  - The org is resolved once per process and cached (`ensureOrgId`) instead of upserting the shared
 *    'public' row on every scan — removing the hot-row write that made concurrent scans collide.
 *  - The repo upsert runs through `upsertRacing`, so a concurrent scan creating the SAME new repo
 *    loses with a P2002 instead of throwing an unhandled 500 — the loser re-reads the row.
 *  - Every write is wrapped in `withRetry`, so a DSQL serialization/OCC conflict at commit — the
 *    expected outcome of real concurrency on a distributed, lock-free store — is retried with
 *    exponential backoff + jitter instead of bubbling up as a failed 500 with no scan saved.
 *  - The dedup + carry-forward read + write run under a per-repo lock (`withRepoLock`), so two scans
 *    of the same repo can't both read the same "previous" snapshot and double-insert.
 *  - The scan graph (scan + dimensions + recommendations), the contributor upserts, and the audit
 *    entry are written in ONE interactive transaction — so a crash mid-way can't leave a scan with
 *    no contributors or no audit row. A failure rolls the whole scan back (surfaced as a throw).
 */
export async function persistScanReport(
  report: ScanReport,
  opts: { orgSlug?: string; actorId?: string; headEtag?: string | null } = {},
): Promise<PersistResult | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgSlug = opts.orgSlug ?? DEFAULT_ORG_SLUG;
  const headSha = report.repo.headSha ?? null;
  const fullName = `${report.repo.owner}/${report.repo.name}`;

  // Resolve the org id once per process (ensureOrgId) instead of upserting the shared 'public' row
  // on every scan — that hot-row write made concurrent scans collide and, under DSQL's optimistic
  // concurrency, fail their commits with a retryable serialization conflict. The repo upsert below
  // still runs per scan (one row per repo, not a shared hot row), but goes through upsertRacing (for
  // the create race) wrapped in withRetry (for a genuine cross-scan OCC conflict on it).
  const orgId = await ensureOrgId(orgSlug);

  // Refresh the repo's head pointer + conditional-request ETag (the durable, cross-instance
  // copy of the in-memory head hint). `undefined` means "leave as-is": a token/private scan
  // carries no public ETag, so it must not clobber the one a public scan stored.
  const repoWhere: Prisma.RepositoryWhereUniqueInput = { orgId_fullName: { orgId, fullName } };
  const repoUpdate: Prisma.RepositoryUpdateInput = {
    url: report.repo.url,
    primaryLanguage: report.repo.primaryLanguage ?? null,
    stars: report.repo.stars,
    isPrivate: report.repo.isPrivate ?? false,
    lastScanAt: new Date(report.scannedAt),
    headSha: headSha ?? undefined,
    headEtag: opts.headEtag ?? undefined,
  };
  const repo = await withRetry(
    () =>
      upsertRacing(
        () =>
          prisma.repository.upsert({
            where: repoWhere,
            update: repoUpdate,
            create: {
              orgId,
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
          }),
        // Lost the create race: the row exists now — apply our update branch to it (upsert semantics).
        () => prisma.repository.update({ where: repoWhere, data: repoUpdate }),
      ),
    { label: "persistScanReport:repo" },
  );

  // Serialize the read-decide-write section per repo so two concurrent scans of the same repo can't
  // both read the same "previous" scan and both insert. The second caller waits, then sees the
  // first's committed scan — dedup catches an identical commit, and carry-forward reads a stable
  // snapshot. (Process-local + best-effort; cross-instance races fall back to the dedup + tx below.)
  return withRepoLock(repo.id, () => withRetry(async () => {
    // Dedup: if this exact commit was already scored, reuse it — no second (metered) Scan row. The
    // repo's metadata + lastScanAt were already refreshed above (so the UI still shows "up to date").
    if (headSha) {
      const existing = await findScanByCommit(repo.id, headSha);
      if (existing) {
        return { scanId: existing.id, deduped: true, headSha, failures: { audit: false, contributors: 0 } };
      }
    }

    // Carry forward recommendation status + ownership (assignee, due date) from this repo's previous
    // scan, so neither progress nor the backlog's planning state is lost on re-scan. Match on
    // dimension + title (stable for mock + low-temp LLM). The per-row event timeline is anchored to
    // the scan's recommendation rows, so it begins fresh each scan while the carried state persists.
    const previous = await prisma.scan.findFirst({
      where: { repoId: repo.id },
      orderBy: { scannedAt: "desc" },
      select: { recommendations: { select: { dimId: true, title: true, status: true, assigneeLogin: true, targetDate: true } } },
    });
    const carry = new Map<string, { status: string; assigneeLogin: string | null; targetDate: Date | null }>();
    for (const r of previous?.recommendations ?? []) {
      carry.set(`${r.dimId}::${r.title}`, { status: r.status, assigneeLogin: r.assigneeLogin, targetDate: r.targetDate });
    }

    // Atomic write: the scan graph (scan + dimensions + recommendations), the contributor upserts,
    // and the audit entry commit together or roll back together — closing the partial-write hole
    // where a crash mid-way left a scan with no contributors or no audit row.
    const scanId = await prisma.$transaction(
      async (tx) => {
        const scan = await tx.scan.create({
          data: {
            repoId: repo.id,
            headSha,
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
            discrepancies: JSON.stringify(report.discrepancies ?? []),
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
              create: report.roadmap.map((r) => {
                const carried = carry.get(`${r.dimension}::${r.title}`);
                return {
                  title: r.title,
                  dimId: r.dimension,
                  impact: r.impact,
                  effort: r.effort,
                  rationale: r.rationale,
                  explore: JSON.stringify(r.explore ?? []),
                  levelUnlock: r.levelUnlock ?? null,
                  status: carried?.status ?? "open",
                  assigneeLogin: carried?.assigneeLogin ?? null,
                  targetDate: carried?.targetDate ?? null,
                };
              }),
            },
          },
          select: { id: true },
        });

        // Recent contributors (top 50, with AI-attribution) for org-wide comparison — in the same
        // tx so they share the scan's fate (no orphaned scan with a half-written contributor set).
        for (const c of report.contributors.slice(0, 50)) {
          await tx.repoContributor.upsert({
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
        }

        // CODEOWNERS team attribution (the team rollup's source). The latest scan is authoritative:
        // replace the repo's whole RepoTeam set so a team removed/renamed in CODEOWNERS can't linger
        // in the team rollups. Guarded on `report.teams` being defined — a reconstructed snapshot
        // that never ran ingestion carries no team data, and must not wipe the stored attribution.
        if (report.teams) {
          await tx.repoTeam.deleteMany({ where: { repoId: repo.id } });
          for (const t of report.teams) {
            await tx.repoTeam.create({
              data: {
                repoId: repo.id,
                slug: t.slug,
                ownedPaths: t.ownedPaths,
                isDefaultOwner: t.isDefaultOwner,
              },
            });
          }
        }

        // Audit entry through the same tx, so a scan is never persisted unaudited (the compliance
        // gap the old best-effort write could leave). Mirrors recordAudit's "scan.created" shape.
        await tx.auditLog.create({
          data: {
            action: "scan.created",
            meta: JSON.stringify({
              repo: fullName,
              scanId: scan.id,
              headSha,
              level: report.level.id,
              score: report.overallScore,
            }),
            orgId,
            actorId: opts.actorId ?? null,
          },
        });

        return scan.id;
      },
      // The body does the scan graph plus up to 50 contributor round-trips; the 5s default is too
      // tight over a remote DSQL link, so allow more time (and a longer wait to acquire a connection).
      { timeout: 20_000, maxWait: 10_000 },
    );

    // A fresh=1 re-test of an UNCHANGED commit just wrote this new Scan row, but this instance's
    // scan cache still holds the prior report under the same owner/repo[@sha]::mode key (TTL/LRU
    // only). Drop both providers — pinned and sha-less — so the next read reflects the just-
    // persisted scan instead of the shadowed stale one. Best-effort + process-local, matching the
    // cache's own scope; other warm instances self-correct on TTL.
    const { owner, name } = report.repo;
    for (const useLLM of [true, false]) {
      cacheDelete(makeCacheKey(owner, name, useLLM, headSha));
      cacheDelete(makeCacheKey(owner, name, useLLM));
    }

    return { scanId, deduped: false, headSha, failures: { audit: false, contributors: 0 } };
  }, { label: "persistScanReport:scan" }));
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
  const limit = opts.limit ?? 30;
  const includeDimensions = opts.includeDimensions ?? true;
  const fullName = `${owner}/${name}`;

  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName } },
  });
  if (!repo) return null;

  // Two statically-typed queries (rather than a dynamic select) so the result type stays precise:
  // the light branch genuinely omits the dimensions join at the DB, not just in the mapping. Each
  // branch maps through toPoint (mapping a single array type, never a union, so it stays type-safe).
  const baseSelect = {
    id: true,
    overallScore: true,
    level: true,
    levelName: true,
    confidence: true,
    engineProvider: true,
    scannedAt: true,
  } as const;
  const args = { where: { repoId: repo.id }, orderBy: { scannedAt: "desc" }, take: limit } as const;

  const toPoint = (s: {
    id: string;
    overallScore: number;
    level: string;
    levelName: string;
    confidence: number;
    engineProvider: string;
    scannedAt: Date;
    dimensions?: { dimId: string; score: number }[];
  }): HistoryPoint => ({
    id: s.id,
    overallScore: s.overallScore,
    level: s.level,
    levelName: s.levelName,
    confidence: s.confidence,
    engineProvider: s.engineProvider,
    scannedAt: s.scannedAt.toISOString(),
    dimensions: s.dimensions ?? [],
  });

  const scans: HistoryPoint[] = includeDimensions
    ? (
        await prisma.scan.findMany({
          ...args,
          select: { ...baseSelect, dimensions: { select: { dimId: true, score: true } } },
        })
      ).map(toPoint)
    : (await prisma.scan.findMany({ ...args, select: baseSelect })).map(toPoint);

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
  assigneeLogin?: string | null;
  targetDate?: Date | null;
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
    assigneeLogin: r.assigneeLogin ?? null,
    targetDate: r.targetDate ? r.targetDate.toISOString().slice(0, 10) : null,
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
          assigneeLogin: true,
          targetDate: true,
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
    scannedAt: scan.scannedAt.toISOString(),
    engine: { provider: scan.engineProvider as ProviderName, model: scan.engineModel },
  };
}

/** Parse a YYYY-MM-DD (or ISO) string to a Date, or null for empty/invalid input. */
function parseDateInput(v?: string | null): Date | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

/** A YYYY-MM-DD key for a nullable date, so a target-date change only logs a real day change. */
function dateKey(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** The fields of a recommendation a user can edit from the backlog. Each key present is applied;
 *  `assigneeLogin`/`targetDate` accept null to clear. Absent keys are left untouched. */
export interface RecommendationPatch {
  status?: RecStatus;
  assigneeLogin?: string | null;
  targetDate?: string | null;
}

/** Who made the change + an optional note, recorded on each resulting timeline event. */
export interface RecommendationActor {
  actor?: string | null;
  note?: string | null;
}

/**
 * Apply a patch (status / assignee / due date) to a recommendation and append an activity-timeline
 * event for each field that actually changed — the ownership-and-history layer behind the backlog.
 * The row update and its events commit in one transaction, so the timeline can never disagree with
 * the current state. A no-op patch (nothing actually changes) writes nothing. Returns null if the
 * DB is disabled; throws Prisma's P2025 when the id doesn't exist (so the route can 404).
 */
export async function updateRecommendation(
  id: string,
  patch: RecommendationPatch,
  opts: RecommendationActor = {},
): Promise<PersistedRecommendation | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();

  const current = await prisma.recommendation.findUnique({ where: { id } });
  if (!current) {
    // Mirror the P2025 a missing-row update would throw, so callers' not-found handling is uniform.
    throw new Prisma.PrismaClientKnownRequestError("Recommendation not found", {
      code: "P2025",
      clientVersion: Prisma.prismaVersion.client,
    });
  }

  const actor = opts.actor?.trim() || null;
  const note = opts.note?.trim() || null;
  const data: Prisma.RecommendationUpdateInput = {};
  const events: Prisma.RecommendationEventCreateManyInput[] = [];
  const event = (kind: RecEventKind, from: string | null, to: string | null) =>
    events.push({ recommendationId: id, actor, kind, fromValue: from, toValue: to, note });

  if (patch.status !== undefined && patch.status !== current.status) {
    data.status = patch.status;
    event("status", current.status, patch.status);
  }

  if (patch.assigneeLogin !== undefined) {
    const next = patch.assigneeLogin?.trim() || null;
    if (next !== current.assigneeLogin) {
      data.assigneeLogin = next;
      event("assignee", current.assigneeLogin, next);
    }
  }

  if (patch.targetDate !== undefined) {
    const next = parseDateInput(patch.targetDate);
    if (dateKey(next) !== dateKey(current.targetDate)) {
      data.targetDate = next;
      event("target_date", dateKey(current.targetDate), dateKey(next));
    }
  }

  // Nothing actually changed — don't write a no-op row update or an empty event.
  if (events.length === 0) return toPersistedRec(current);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.recommendation.update({ where: { id }, data });
    await tx.recommendationEvent.createMany({ data: events });
    return row;
  });

  // Best-effort audit (the durable timeline above is the source of truth). Records the actor and a
  // compact summary of what moved so the org audit viewer reflects backlog activity too.
  await recordAudit(
    "recommendation.updated",
    { id, actor, changes: events.map((e) => ({ kind: e.kind, from: e.fromValue, to: e.toValue })) },
  );
  return toPersistedRec(updated);
}

/** Update only a recommendation's status (back-compat wrapper over updateRecommendation). */
export async function updateRecommendationStatus(
  id: string,
  status: RecStatus,
  opts: RecommendationActor = {},
): Promise<PersistedRecommendation | null> {
  return updateRecommendation(id, { status }, opts);
}

/**
 * A recommendation's activity timeline — every status / assignee / due-date change, newest first.
 * Returns null when persistence is disabled, or an empty array when the id has no recorded changes.
 */
export async function getRecommendationEvents(id: string): Promise<RecEvent[] | null> {
  if (!isDbConfigured()) return null;
  const rows = await getPrisma().recommendationEvent.findMany({
    where: { recommendationId: id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map((e) => ({
    id: e.id,
    actor: e.actor,
    kind: e.kind as RecEventKind,
    from: e.fromValue,
    to: e.toValue,
    note: e.note,
    at: e.createdAt.toISOString(),
  }));
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
