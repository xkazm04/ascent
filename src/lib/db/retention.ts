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
// `deleteMany`s can hit serialization conflicts. We delete in small batches and retry the
// individual batch on a write-conflict (P2034 / SQLSTATE 40001). relationMode = "prisma"
// emits no FK cascades, so child rows (dimensions, recommendations) are deleted explicitly
// before their parent Scan.

import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/scans";

/** Audit action recorded by the purge job for each org it enforces a policy on. */
export const PURGE_ACTION = "retention.purged";

const DAY_MS = 86_400_000;
export const RETENTION_DEFAULT_BATCH_SIZE = 500;
const RETENTION_MAX_BATCH_SIZE = 5000;

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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** True when an error is a DSQL/Postgres serialization conflict that's safe to retry. */
function isSerializationConflict(err: unknown): boolean {
  // Prisma maps write conflicts / deadlocks (incl. DSQL OCC aborts) to P2034.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("40001") ||
    msg.includes("serializ") ||
    msg.includes("write conflict") ||
    msg.includes("deadlock")
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run a single batch delete, retrying only on serialization conflicts (DSQL OCC). */
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isSerializationConflict(err) || i === attempts - 1) throw err;
      await sleep(50 * (i + 1)); // linear backoff; conflicts clear quickly under OCC
    }
  }
  throw lastErr;
}

type PrismaLike = ReturnType<typeof getPrisma>;

/** Per-repo: delete every scan beyond the newest `max`, with its dimensions + recommendations. */
async function pruneRepoScans(
  prisma: PrismaLike,
  repoId: string,
  max: number,
  batchSize: number,
): Promise<{ scans: number; dimensions: number; recommendations: number }> {
  // Scans to drop = everything after the newest `max` (stable order via id tiebreak).
  const stale = await prisma.scan.findMany({
    where: { repoId },
    orderBy: [{ scannedAt: "desc" }, { id: "desc" }],
    skip: max,
    select: { id: true },
  });

  let scans = 0;
  let dimensions = 0;
  let recommendations = 0;
  for (const ids of chunk(stale.map((s) => s.id), batchSize)) {
    // Children first — relationMode = "prisma" emits no FK cascade.
    dimensions += (await withRetry(() => prisma.scanDimension.deleteMany({ where: { scanId: { in: ids } } }))).count;
    recommendations += (await withRetry(() => prisma.recommendation.deleteMany({ where: { scanId: { in: ids } } }))).count;
    scans += (await withRetry(() => prisma.scan.deleteMany({ where: { id: { in: ids } } }))).count;
  }
  return { scans, dimensions, recommendations };
}

/** Batched delete of audit entries matching `where` (oldest first), DSQL-friendly. */
async function pruneAudit(
  prisma: PrismaLike,
  where: Prisma.AuditLogWhereInput,
  batchSize: number,
): Promise<number> {
  let total = 0;
  for (;;) {
    const ids = (
      await prisma.auditLog.findMany({ where, orderBy: { at: "asc" }, take: batchSize, select: { id: true } })
    ).map((r) => r.id);
    if (ids.length === 0) break;
    total += (await withRetry(() => prisma.auditLog.deleteMany({ where: { id: { in: ids } } }))).count;
    if (ids.length < batchSize) break;
  }
  return total;
}

/** What a single org's (or the orphan sweep's) purge removed. */
export interface OrgPurgeResult {
  orgSlug: string;
  policy: RetentionPolicy;
  scansDeleted: number;
  dimensionsDeleted: number;
  recommendationsDeleted: number;
  auditDeleted: number;
}

/** Roll-up of a full purge run across every org. */
export interface PurgeSummary {
  orgsProcessed: number;
  scansDeleted: number;
  dimensionsDeleted: number;
  recommendationsDeleted: number;
  auditDeleted: number;
  results: OrgPurgeResult[];
  errors: string[];
}

/**
 * Enforce the data-retention policy across every org: prune old scans (+ their dimensions and
 * recommendations) beyond the newest N per repo, and drop audit entries older than X days.
 * Records a `retention.purged` audit entry per enforced org (the job audits itself), and sweeps
 * org-less audit entries under the global default. Deletes in small, retry-on-conflict batches
 * for Aurora DSQL. Returns null when persistence is disabled.
 */
export async function purgeExpiredData(opts: { actorId?: string } = {}): Promise<PurgeSummary | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const defaults = envRetentionDefaults();

  const orgs = await prisma.organization.findMany({
    select: { id: true, slug: true, retentionMaxScans: true, retentionAuditDays: true },
  });

  const results: OrgPurgeResult[] = [];
  const errors: string[] = [];

  for (const org of orgs) {
    const policy = resolveRetention(defaults, org);
    // Nothing to enforce for this org — skip (don't write a no-op audit entry).
    if (policy.maxScansPerRepo <= 0 && policy.auditDays <= 0) continue;

    try {
      let scansDeleted = 0;
      let dimensionsDeleted = 0;
      let recommendationsDeleted = 0;
      let auditDeleted = 0;

      if (policy.maxScansPerRepo > 0) {
        const repos = await prisma.repository.findMany({ where: { orgId: org.id }, select: { id: true } });
        for (const repo of repos) {
          const r = await pruneRepoScans(prisma, repo.id, policy.maxScansPerRepo, policy.batchSize);
          scansDeleted += r.scans;
          dimensionsDeleted += r.dimensions;
          recommendationsDeleted += r.recommendations;
        }
      }

      if (policy.auditDays > 0) {
        const cutoff = new Date(Date.now() - policy.auditDays * DAY_MS);
        auditDeleted = await pruneAudit(prisma, { orgId: org.id, at: { lt: cutoff } }, policy.batchSize);
      }

      // The purge job records its own audit entry (compliance trace of what was removed).
      // Written after the deletes so the entry is recent and survives this run's audit cutoff.
      await recordAudit(
        PURGE_ACTION,
        {
          scansDeleted,
          dimensionsDeleted,
          recommendationsDeleted,
          auditDeleted,
          policy: { maxScansPerRepo: policy.maxScansPerRepo, auditDays: policy.auditDays },
        },
        { orgId: org.id, actorId: opts.actorId },
      );

      results.push({
        orgSlug: org.slug,
        policy,
        scansDeleted,
        dimensionsDeleted,
        recommendationsDeleted,
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
        await recordAudit(PURGE_ACTION, { auditDeleted, scope: "orphan" }, { actorId: opts.actorId });
        results.push({
          orgSlug: "(orphan)",
          policy: defaults,
          scansDeleted: 0,
          dimensionsDeleted: 0,
          recommendationsDeleted: 0,
          auditDeleted,
        });
      }
    } catch (err) {
      errors.push(`(orphan): ${err instanceof Error ? err.message : "purge failed"}`);
    }
  }

  return {
    orgsProcessed: results.length,
    scansDeleted: results.reduce((a, r) => a + r.scansDeleted, 0),
    dimensionsDeleted: results.reduce((a, r) => a + r.dimensionsDeleted, 0),
    recommendationsDeleted: results.reduce((a, r) => a + r.recommendationsDeleted, 0),
    auditDeleted: results.reduce((a, r) => a + r.auditDeleted, 0),
    results,
    errors,
  };
}
