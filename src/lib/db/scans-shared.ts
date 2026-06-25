// Shared internals for the scans.* sub-modules (persist/read/recommendations/audit). These helpers
// and the org-id resolution layer are used by MORE THAN ONE group, so they live here to avoid a
// cross-group import cycle. INTERNAL: not re-exported from `@/lib/db` — only the scans-*.ts modules
// import from here.

import type {
  DimensionId,
  Effort,
  Impact,
  PersistedRecommendation,
  RecStatus,
} from "@/lib/types";
import { Prisma } from "@prisma/client";
import { getPrisma, withRetry } from "@/lib/db/client";

/** The implicit tenant for anonymous/public scans — the shared org every DB-less-MVP scan lands in. */
export const DEFAULT_ORG_SLUG = "public";

/**
 * Canonical key for a repository's `fullName` column. GitHub treats owner/repo case-insensitively, so
 * the SAME repo must map to ONE key regardless of the casing a caller typed — we lowercase both sides.
 * Reader and writer MUST agree on this: previously writes keyed by GitHub-canonical casing
 * (`report.repo.owner/name`) while reads built `fullName` from the raw caller casing, so a mixed-case
 * reference ("Facebook/React") always missed the case-sensitive unique index — silently defeating the
 * cross-instance cache, the conditional-304 head hint, and the stale-salvage path (the invariant
 * cache.ts's makeCacheKey documents, never enforced at the DB tier). The DISPLAY casing is preserved
 * separately in the `owner`/`name` columns. Transitional note: a pre-existing mixed-case row is re-keyed
 * on its next scan (one extra scan; the old row ages out via retention).
 */
export function canonicalRepoFullName(owner: string, name: string): string {
  return `${owner.trim().toLowerCase()}/${name.trim().toLowerCase()}`;
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
export async function ensureOrgId(orgSlug: string): Promise<string> {
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
 * Resolve an org slug to its id — the tenant scope. Returns null when the org doesn't
 * exist. Repo lookups MUST go through this: `fullName` is only unique *within* an org
 * (`@@unique([orgId, fullName])`), so resolving by fullName alone (findFirst) can return
 * another tenant's repo and leak its scores/recommendations across org boundaries.
 */
export async function resolveOrgId(orgSlug: string): Promise<string | null> {
  const org = await getPrisma().organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true },
  });
  return org?.id ?? null;
}

/**
 * Parse a persisted string-array JSON column (`explore`, `evidence`, `gaps`, …): malformed JSON,
 * null/empty, or a non-array all yield `[]`, and non-string entries are dropped. The single canonical
 * parser for stored `string[]` columns — lives here (the dependency sink) so both scans-shared and
 * scans-read use one implementation instead of two that drift in edge handling.
 */
export function parseStringArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Map a persisted Recommendation row to the API-facing PersistedRecommendation shape — parsing the
 * stored `explore` JSON (dropping non-string entries) and normalizing nullable fields. Shared by the
 * read path (getLatestRecommendations) and the mutation path (updateRecommendation).
 */
export function toPersistedRec(r: {
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
  return {
    id: r.id,
    title: r.title,
    dimension: r.dimId as DimensionId,
    impact: r.impact as Impact,
    effort: r.effort as Effort,
    rationale: r.rationale,
    explore: parseStringArray(r.explore),
    levelUnlock: r.levelUnlock ?? undefined,
    status: r.status as RecStatus,
    assigneeLogin: r.assigneeLogin ?? null,
    targetDate: r.targetDate ? r.targetDate.toISOString().slice(0, 10) : null,
  };
}
