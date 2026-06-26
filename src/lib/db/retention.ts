// Configurable data retention + automated purge.
//
// Scan, ScanDimension, Recommendation, and AuditLog grow unbounded as the corpus scales —
// a storage-cost and compliance liability for an audit product. This module enforces a
// per-org retention policy: keep only the newest N scans per repo (and their dimensions +
// recommendations), and drop audit entries older than X days. It is driven by the
// /api/cron/purge route handler (a daily Vercel Cron).
//
// Configuration mirrors what Datadog / Splunk / Stripe expose:
//   - Global defaults via env (RETENTION_MAX_SCANS_PER_REPO / RETENTION_AUDIT_DAYS).
//   - Per-org overrides via Organization.retentionMaxScans / retentionAuditDays
//     (null = inherit the env default; 0 = unlimited / keep everything).
// Retention is OPT-IN: with nothing configured, every window is 0 and nothing is deleted,
// so existing deployments keep their current behavior until they ask for retention.
//
// DSQL-safe by design: DSQL uses optimistic concurrency control (no row locks), so large
// `deleteMany`s can hit serialization conflicts. We delete in small batches and retry each
// batch through the SHARED withRetry / isSerializationConflictError from db/client — which
// recognizes DSQL's native OC### conflict codes, the 40P01 deadlock SQLSTATE, and P2034, and
// backs off with full jitter (the local copy this module used to carry missed the OC### codes
// and re-collided in lockstep). relationMode = "prisma" emits no FK cascades, so child rows
// (dimensions, recommendations) are deleted explicitly before their parent Scan.

import type { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured, withRetry } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/scans";
import { purgeStalePublicScanQuota } from "@/lib/public-scan-quota";

/** Audit action recorded by the purge job for each org it enforces a policy on. */
export const PURGE_ACTION = "retention.purged";

const DAY_MS = 86_400_000;
export const RETENTION_DEFAULT_BATCH_SIZE = 500;
const RETENTION_MAX_BATCH_SIZE = 5000;
/** Wall-clock budget for the per-org loop. Stays comfortably under the route's maxDuration (300s) so
 *  the run finishes cleanly instead of being killed mid-delete by the platform. (data-retention #2) */
const RETENTION_DEFAULT_TIME_BUDGET_MS = 250_000;
/** Repos enumerated per page when pruning an org, so a fleet org's repo list is never read all at once. */
const REPO_PAGE_SIZE = 500;

/** An effective retention policy. A window of `0` means "keep everything" (disabled). */
export interface RetentionPolicy {
  /** Keep only the newest N scans per repo; 0 = unlimited. */
  maxScansPerRepo: number;
  /** Delete audit entries older than N days; 0 = unlimited. */
  auditDays: number;
  /** Rows deleted per batch (bounds DSQL serialization-conflict surface). */
  batchSize: number;
}

/** Parse a non-negative integer env value; null when unset/blank/invalid (→ caller default). */
function parseNonNegInt(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** Clamp a configured batch size into a sane range; falls back to the default. */
export function clampBatchSize(n: number | null): number {
  if (n == null || n <= 0) return RETENTION_DEFAULT_BATCH_SIZE;
  return Math.min(Math.floor(n), RETENTION_MAX_BATCH_SIZE);
}

/** Global retention defaults read from the environment (the fallback for every org). */
export function envRetentionDefaults(): RetentionPolicy {
  return {
    maxScansPerRepo: parseNonNegInt(process.env.RETENTION_MAX_SCANS_PER_REPO) ?? 0,
    auditDays: parseNonNegInt(process.env.RETENTION_AUDIT_DAYS) ?? 0,
    batchSize: clampBatchSize(parseNonNegInt(process.env.RETENTION_BATCH_SIZE)),
  };
}

/**
 * Resolve an org's effective policy: a per-org override (when set, including an explicit `0`
 * for "unlimited") wins over the global default; `null` inherits the default. Pure — unit-tested.
 */
export function resolveRetention(
  defaults: RetentionPolicy,
  org: { retentionMaxScans: number | null; retentionAuditDays: number | null },
): RetentionPolicy {
  return {
    maxScansPerRepo: org.retentionMaxScans ?? defaults.maxScansPerRepo,
    auditDays: org.retentionAuditDays ?? defaults.auditDays,
    batchSize: defaults.batchSize,
  };
}

type PrismaLike = ReturnType<typeof getPrisma>;

/**
 * Shared DSQL-friendly paging-delete skeleton used by both prune loops: select up to `batchSize` ids,
 * stop on an empty page, delete them (the caller's `deleteByIds` closure wraps its own withRetry +
 * accumulation), then stop when the page was short OR when a delete made no progress (the `deleted === 0`
 * guard prevents an infinite loop if a delete removes nothing — harmless for the always-progressing
 * audit path). `deleteByIds` returns the count of progress-rows removed for that termination check.
 */
async function deleteInPages(
  selectIds: () => Promise<string[]>,
  deleteByIds: (ids: string[]) => Promise<number>,
  batchSize: number,
): Promise<void> {
  for (;;) {
    const ids = await selectIds();
    if (ids.length === 0) break;
    const deleted = await deleteByIds(ids);
    if (deleted === 0 || ids.length < batchSize) break;
  }
}

/** Per-repo: delete every scan beyond the newest `max`, with its dimensions + recommendations. */
async function pruneRepoScans(
  prisma: PrismaLike,
  repoId: string,
  max: number,
  batchSize: number,
): Promise<{ scans: number; dimensions: number; recommendations: number; events: number }> {
  let scans = 0;
  let dimensions = 0;
  let recommendations = 0;
  let events = 0;
  // Page the SELECTION too, not just the deletes. The prior code did one UNBOUNDED findMany(skip:max)
  // pulling every stale id into memory before the batched delete loop — on a long-watched repo with a
  // huge per-commit scan history that single read can hit a DSQL statement timeout / memory pressure
  // and abort the whole prune, so the table the job exists to bound keeps growing. Re-`skip: max` each
  // page (always keep the newest `max`); the prior page's rows are now deleted, so `skip:max` advances
  // to the next stale window. Stop when a page is short. Rank by DB-authoritative `createdAt` (insertion
  // order), NOT report `scannedAt`: a backdated/skewed scannedAt could otherwise drop a live newer scan.
  // deleteInPages owns the short-page/empty-page/zero-progress termination (the `counts.sc === 0` guard).
  await deleteInPages(
    async () =>
      (
        await prisma.scan.findMany({
          where: { repoId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: max,
          take: batchSize,
          select: { id: true },
        })
      ).map((s) => s.id),
    async (ids) => {
      // Delete the whole scan sub-graph for this batch in ONE transaction so a mid-batch timeout can't
      // leave a half-deleted graph. relationMode = "prisma" emits no FK cascade, so the grandchildren
      // (RecommendationEvent) must be deleted BEFORE their parent Recommendation or they orphan forever.
      // Order: grandchildren (events) → children (dimensions, recommendations) → parent (scan).
      const counts = await withRetry(
        () =>
          prisma.$transaction(async (tx) => {
            const recIds = (
              await tx.recommendation.findMany({ where: { scanId: { in: ids } }, select: { id: true } })
            ).map((r) => r.id);
            const ev = recIds.length
              ? (await tx.recommendationEvent.deleteMany({ where: { recommendationId: { in: recIds } } })).count
              : 0;
            const dim = (await tx.scanDimension.deleteMany({ where: { scanId: { in: ids } } })).count;
            const rec = (await tx.recommendation.deleteMany({ where: { scanId: { in: ids } } })).count;
            const sc = (await tx.scan.deleteMany({ where: { id: { in: ids } } })).count;
            return { ev, dim, rec, sc };
          }),
        { label: "retention.prune-scans" },
      );
      events += counts.ev;
      dimensions += counts.dim;
      recommendations += counts.rec;
      scans += counts.sc;
      return counts.sc; // progress count → zero stops the loop (a delete that removed no scan rows)
    },
    batchSize,
  );
  return { scans, dimensions, recommendations, events };
}

/** Batched delete of audit entries matching `where` (oldest first), DSQL-friendly. */
async function pruneAudit(
  prisma: PrismaLike,
  where: Prisma.AuditLogWhereInput,
  batchSize: number,
): Promise<number> {
  let total = 0;
  await deleteInPages(
    async () =>
      (
        await prisma.auditLog.findMany({ where, orderBy: { at: "asc" }, take: batchSize, select: { id: true } })
      ).map((r) => r.id),
    async (ids) => {
      const count = (
        await withRetry(() => prisma.auditLog.deleteMany({ where: { id: { in: ids } } }), {
          label: "retention.prune-audit",
        })
      ).count;
      total += count;
      return count;
    },
    batchSize,
  );
  return total;
}

/** What a single org's (or the orphan sweep's) purge removed. */
export interface OrgPurgeResult {
  orgSlug: string;
  policy: RetentionPolicy;
  scansDeleted: number;
  dimensionsDeleted: number;
  recommendationsDeleted: number;
  recommendationEventsDeleted: number;
  auditDeleted: number;
}

/** Roll-up of a full purge run across every org. */
export interface PurgeSummary {
  orgsProcessed: number;
  scansDeleted: number;
  dimensionsDeleted: number;
  recommendationsDeleted: number;
  recommendationEventsDeleted: number;
  auditDeleted: number;
  results: OrgPurgeResult[];
  errors: string[];
  /** True when the wall-clock budget stopped the loop before every org was reached this tick
   *  (data-retention #2). The next tick re-shuffles and resumes the unreached orgs. */
  stoppedEarly?: boolean;
  /** How many orgs were not reached this tick because the budget was exhausted (0 on a full run). */
  orgsRemaining?: number;
}

/** Options for {@link purgeExpiredData}. Clock + RNG are injectable so the budget/rotation are testable. */
export interface PurgeOptions {
  actorId?: string;
  /** Wall-clock budget (ms) for the org loop; defaults to RETENTION_TIME_BUDGET_MS env or 250_000. */
  timeBudgetMs?: number;
  /** Monotonic-ish clock (ms). Defaults to Date.now. */
  now?: () => number;
  /** Jitter source in [0, 1). Defaults to Math.random. */
  random?: () => number;
}

/** Fisher-Yates in-place shuffle, so each cron tick rotates the org order (data-retention #2). */
function shuffleInPlace<T>(arr: T[], random: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

/**
 * Enforce the data-retention policy across every org: prune old scans (+ their dimensions and
 * recommendations) beyond the newest N per repo, and drop audit entries older than X days.
 * Records a `retention.purged` audit entry per enforced org (the job audits itself), and sweeps
 * org-less audit entries under the global default. Deletes in small, retry-on-conflict batches
 * for Aurora DSQL. Returns null when persistence is disabled.
 */
export async function purgeExpiredData(opts: PurgeOptions = {}): Promise<PurgeSummary | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const defaults = envRetentionDefaults();
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const timeBudgetMs =
    opts.timeBudgetMs ?? (parseNonNegInt(process.env.RETENTION_TIME_BUDGET_MS) || RETENTION_DEFAULT_TIME_BUDGET_MS);
  const startedAt = now();

  const orgs = await prisma.organization.findMany({
    select: { id: true, slug: true, retentionMaxScans: true, retentionAuditDays: true },
  });

  // Tail-org starvation guard (data-retention #2): the run is strictly sequential under the route's
  // 300s maxDuration, and with a STABLE org order a large fleet that can't drain in one tick dies at
  // the same prefix every run — so late-ordered orgs are NEVER reached and their retention is never
  // enforced (the exact failure this module exists to prevent), worst for the biggest fleets. Two
  // cheap, schema-free defenses, combined: (1) rotate the order each tick (shuffle) so no org is
  // deterministically last, and (2) stop cleanly once a wall-clock budget is exhausted — before the
  // platform kills the function mid-delete — surfacing the unreached count so the route's non-2xx
  // alerting (finding #1) trips. Over a few ticks every org is reached instead of never.
  shuffleInPlace(orgs, random);

  const results: OrgPurgeResult[] = [];
  const errors: string[] = [];
  let stoppedEarly = false;
  let orgsRemaining = 0;

  for (let i = 0; i < orgs.length; i++) {
    if (now() - startedAt >= timeBudgetMs) {
      stoppedEarly = true;
      orgsRemaining = orgs.length - i;
      errors.push(
        `(budget): retention stopped after ${Math.round((now() - startedAt) / 1000)}s with ${orgsRemaining} org(s) unprocessed this tick`,
      );
      break;
    }
    const org = orgs[i]!;
    const policy = resolveRetention(defaults, org);
    // Nothing to enforce for this org — skip (don't write a no-op audit entry).
    if (policy.maxScansPerRepo <= 0 && policy.auditDays <= 0) continue;

    try {
      let scansDeleted = 0;
      let dimensionsDeleted = 0;
      let recommendationsDeleted = 0;
      let recommendationEventsDeleted = 0;
      let auditDeleted = 0;

      if (policy.maxScansPerRepo > 0) {
        // Page the repo enumeration with a stable id cursor (data-retention #5): the prior single
        // unbounded findMany pulled EVERY repo id for the org into memory at once — a fleet org
        // watching thousands of repos is a large read that compounds the timeout/memory exposure the
        // scan SELECT was already paged to avoid. Fetch a bounded page, prune it, advance past the
        // last id; stop on a short page. Keep per-repo pruning serial so DSQL conflict pressure stays
        // bounded (each prune is itself batched + retry-on-conflict).
        let repoCursor: string | undefined;
        for (;;) {
          const repos = await prisma.repository.findMany({
            where: { orgId: org.id },
            orderBy: { id: "asc" },
            select: { id: true },
            take: REPO_PAGE_SIZE,
            ...(repoCursor ? { cursor: { id: repoCursor }, skip: 1 } : {}),
          });
          if (repos.length === 0) break;
          for (const repo of repos) {
            const r = await pruneRepoScans(prisma, repo.id, policy.maxScansPerRepo, policy.batchSize);
            scansDeleted += r.scans;
            dimensionsDeleted += r.dimensions;
            recommendationsDeleted += r.recommendations;
            recommendationEventsDeleted += r.events;
          }
          if (repos.length < REPO_PAGE_SIZE) break;
          repoCursor = repos[repos.length - 1]!.id;
        }
      }

      if (policy.auditDays > 0) {
        const cutoff = new Date(Date.now() - policy.auditDays * DAY_MS);
        auditDeleted = await pruneAudit(prisma, { orgId: org.id, at: { lt: cutoff } }, policy.batchSize);
      }

      // The purge job records its own audit entry (compliance trace of what was removed).
      // Written after the deletes so the entry is recent and survives this run's audit cutoff.
      // recordAudit swallows its own error and returns false — for an audit/compliance product, a
      // destructive purge that loses its "what was deleted and when" trace must surface as a degraded
      // run, not a green 200, so check the boolean and push to errors.
      //
      // Only write the audit entry when something was actually deleted (data-retention #4): a policy
      // that's set but currently has nothing expired would otherwise write an all-zero retention.purged
      // row for every configured org every cron tick, forever — noise that obscures the real trail in an
      // audit product. Mirrors the orphan sweep's `auditDeleted > 0` gate below.
      const totalDeleted =
        scansDeleted + dimensionsDeleted + recommendationsDeleted + recommendationEventsDeleted + auditDeleted;
      if (totalDeleted > 0) {
        const audited = await recordAudit(
          PURGE_ACTION,
          {
            scansDeleted,
            dimensionsDeleted,
            recommendationsDeleted,
            recommendationEventsDeleted,
            auditDeleted,
            policy: { maxScansPerRepo: policy.maxScansPerRepo, auditDays: policy.auditDays },
          },
          { orgId: org.id, actorId: opts.actorId },
        );
        if (!audited) {
          errors.push(`${org.slug}: retention audit write failed (deletes applied, compliance trace missing)`);
        }
      }

      results.push({
        orgSlug: org.slug,
        policy,
        scansDeleted,
        dimensionsDeleted,
        recommendationsDeleted,
        recommendationEventsDeleted,
        auditDeleted,
      });
    } catch (err) {
      errors.push(`${org.slug}: ${err instanceof Error ? err.message : "purge failed"}`);
    }
  }

  // Org-less audit entries (e.g. anonymous public scans) can't carry a per-org policy — sweep
  // them under the global default window so AuditLog can't grow unbounded from that path.
  if (defaults.auditDays > 0) {
    try {
      const cutoff = new Date(Date.now() - defaults.auditDays * DAY_MS);
      const auditDeleted = await pruneAudit(prisma, { orgId: null, at: { lt: cutoff } }, defaults.batchSize);
      if (auditDeleted > 0) {
        const audited = await recordAudit(PURGE_ACTION, { auditDeleted, scope: "orphan" }, { actorId: opts.actorId });
        if (!audited) {
          errors.push(`(orphan): retention audit write failed (deletes applied, compliance trace missing)`);
        }
        results.push({
          orgSlug: "(orphan)",
          policy: defaults,
          scansDeleted: 0,
          dimensionsDeleted: 0,
          recommendationsDeleted: 0,
          recommendationEventsDeleted: 0,
          auditDeleted,
        });
      }
    } catch (err) {
      errors.push(`(orphan): ${err instanceof Error ? err.message : "purge failed"}`);
    }
  }

  // Sweep PublicScanQuota rows whose rolling window has fully aged out — they carry no live state
  // (only a re-grantable full allowance), so the IP-keyed table can't be allowed to grow unbounded.
  // Always runs (it's not governed by a per-org retention window); best-effort.
  try {
    await purgeStalePublicScanQuota();
  } catch (err) {
    errors.push(`(public-scan-quota): ${err instanceof Error ? err.message : "purge failed"}`);
  }

  return {
    orgsProcessed: results.length,
    scansDeleted: results.reduce((a, r) => a + r.scansDeleted, 0),
    dimensionsDeleted: results.reduce((a, r) => a + r.dimensionsDeleted, 0),
    recommendationsDeleted: results.reduce((a, r) => a + r.recommendationsDeleted, 0),
    recommendationEventsDeleted: results.reduce((a, r) => a + r.recommendationEventsDeleted, 0),
    auditDeleted: results.reduce((a, r) => a + r.auditDeleted, 0),
    results,
    errors,
    stoppedEarly,
    orgsRemaining,
  };
}
