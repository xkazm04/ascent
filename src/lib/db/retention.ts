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
import { redactAuditIdentity } from "@/lib/db/audit-integrity";
import { ATHENA_MEMORY_SOURCE } from "@/lib/db/athena-episodes";
import { purgeStalePublicScanQuota } from "@/lib/public-scan-quota";
import {
  DIGEST_PREVIEW_MAX_SCANS,
  digestPeriod,
  digestScans,
  monthsBefore,
  pruneDigests,
  resolveCompaction,
  UNKNOWN_RUBRIC,
  upsertDigests,
  type DigestInputScan,
} from "@/lib/db/scan-digest";

/** Audit action recorded by the purge job for each org it enforces a policy on. */
export const PURGE_ACTION = "retention.purged";

/** Audit action recorded by the ON-DEMAND erasure path ({@link eraseOrgData}) — the DSR trace. */
export const ERASE_ACTION = "data.erased";

const DAY_MS = 86_400_000;
export const RETENTION_DEFAULT_BATCH_SIZE = 500;
const RETENTION_MAX_BATCH_SIZE = 5000;
/**
 * The function cap the /api/cron/purge route DECLARES (`export const maxDuration = 300`). Next.js
 * requires that segment config to be a statically-analyzable literal, so the route cannot import this
 * constant — instead this is the single source the time budget is DERIVED from, and a route test pins
 * `route.maxDuration === PURGE_MAX_DURATION_S` so the two can never drift apart silently
 * (data-retention 07-16 #1: they used to be two unrelated magic numbers in two files).
 *
 * CONTRACT / plan caveat: `maxDuration` is a *request*, not a guarantee — the platform honors it only
 * up to the deployment plan's function cap (e.g. Vercel Hobby caps far lower). On such a plan the
 * derived budget below never trips and large runs are hard-killed mid-delete with no summary; set
 * RETENTION_TIME_BUDGET_MS comfortably below the REAL cap for your plan (purgeExpiredData warns when
 * the env budget is >= this declared cap).
 */
export const PURGE_MAX_DURATION_S = 300;
/** Headroom the budget leaves before the declared function cap, so the run can stop at a batch
 *  boundary, write its (partial) summary, and return a 207 before the platform kills the function. */
export const RETENTION_BUDGET_HEADROOM_MS = 50_000;
// Soft wall-clock budget for a single purge run (data-retention #2), DERIVED from the route's declared
// cap (never hardcoded independently — see PURGE_MAX_DURATION_S). Stop cleanly a bit before the cap: a
// large fleet then returns a proper (partial) summary that records where it stopped, instead of being
// hard-killed mid-delete with no throw and no summary log. Override via RETENTION_TIME_BUDGET_MS (ms).
// Governs the per-org loop, its INNER repo/scan/audit batches (data-retention #1 — a single mega-org
// must yield too, not only the gaps between orgs), and the trailing sweeps.
// `RETENTION_TIME_BUDGET_MS=0` means UNLIMITED — no budget, run to completion (data-retention 07-16 #5):
// this matches the module-wide "0 = disabled" convention its sibling env vars follow (a self-hosted
// deployment with no platform kill-timer needs a way to disable the budget). Unset/blank/invalid falls
// back to this derived default.
export const RETENTION_DEFAULT_TIME_BUDGET_MS = PURGE_MAX_DURATION_S * 1000 - RETENTION_BUDGET_HEADROOM_MS;
/** Repos enumerated per page when pruning an org, so a fleet org's repo list is never read all at once. */
const REPO_PAGE_SIZE = 500;

// Destructive-override safety floor (data-retention 07-16 #2). A per-org override is applied verbatim,
// so a fat-fingered `retentionMaxScans = 1` (meant `100`) or `retentionAuditDays = 1` would irreversibly
// wipe nearly all of an org's scan history / audit trail on the next cron tick — for an audit product,
// the compliance evidence itself. A configured-but-below-floor window is therefore REFUSED (the org is
// skipped and an error is pushed, so the route's 207 alerting pages an operator) unless the operator
// explicitly opts in with RETENTION_FORCE=1. `0` still means "keep everything" and is never floored.
// Preview what any policy would delete first via `?dryRun=1` on /api/cron/purge (PurgeOptions.dryRun).
export const RETENTION_MIN_SCANS_PER_REPO = 5;
export const RETENTION_MIN_AUDIT_DAYS = 7;

/**
 * MOONSHOT #10 — how long a SETTLED `ScanJob` is kept. A fixed horizon rather than a per-org policy
 * on purpose: a queue row is operational plumbing (what was enqueued, what claimed it, what it
 * returned), not tenant evidence, so there is nothing here for an org to have an opinion about, and
 * an org that configured NO retention at all must still not accumulate a queue forever. Thirty days
 * is the window an operator can actually use — long enough to explain "why did this repo not rescan
 * three weeks ago" from the rows themselves, short enough that the table stays a queue.
 */
export const SCAN_JOB_RETENTION_DAYS = 30;

/** The terminal `ScanJob.state` values the sweep above is allowed to remove. A `queued` or `claimed`
 *  row is LIVE work — deleting one on age would silently drop a job rather than retire its record,
 *  and a stuck claim is released by its lease, never by retention. */
export const SCAN_JOB_SETTLED_STATES = ["done", "failed", "skipped"] as const;

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
  budgetExceeded?: () => boolean,
): Promise<void> {
  for (;;) {
    // Yield BETWEEN batches when the run's wall-clock budget is spent (data-retention #1). A single
    // long-watched repo (or a huge org-less audit sweep) can otherwise loop for minutes here with no
    // budget check, blowing past the route's maxDuration and getting hard-killed mid-delete. We only
    // stop at a batch boundary — every committed batch was its own transaction, so the partial state is
    // safe and the next tick's re-selection resumes exactly where this one left off.
    if (budgetExceeded?.()) break;
    const ids = await selectIds();
    if (ids.length === 0) break;
    const deleted = await deleteByIds(ids);
    if (deleted === 0 || ids.length < batchSize) break;
  }
}

/** The Scan columns the digest fold reads (MOONSHOT #32) — selected only when compaction is on. */
const DIGEST_SCAN_SELECT = {
  id: true,
  scannedAt: true,
  headSha: true,
  overallScore: true,
  adoptionScore: true,
  rigorScore: true,
  confidence: true,
  level: true,
  levelName: true,
  posture: true,
  rubricVersion: true,
  engineProvider: true,
  engineModel: true,
  dimensions: { select: { dimId: true, score: true, signalScore: true, llmScore: true } },
  recommendations: { select: { status: true } },
} as const;

/** What one pruned repo removed — and, when compaction is on, what SURVIVED as a digest. */
interface RepoPruneResult {
  scans: number;
  dimensions: number;
  recommendations: number;
  events: number;
  outcomes: number;
  /** Digest rows created or updated by this repo's fold (0 when compaction is off). */
  digestsWritten: number;
  /** Scans that were folded before they were deleted (0 when compaction is off). */
  scansCompacted: number;
  /** Dry run only: distinct (period, rubric, provider) keys the fold WOULD touch. `null` = unknown,
   *  because the stale window is past {@link DIGEST_PREVIEW_MAX_SCANS} and an estimate would be a
   *  guess wearing a number's clothes (G4). Always `null` outside a dry run / with compaction off. */
  digestsWouldWrite: number | null;
}

/** Per-repo: delete every scan beyond the newest `max`, with its dimensions + recommendations. */
async function pruneRepoScans(
  prisma: PrismaLike,
  repoId: string,
  max: number,
  batchSize: number,
  budgetExceeded?: () => boolean,
  countOnly = false,
  /** MOONSHOT #32: fold each page into a `ScanDigest` inside the transaction that deletes it.
   *  OFF by default, so an existing deployment's purge — and its page SELECT — is unchanged. */
  compact = false,
): Promise<RepoPruneResult> {
  let scans = 0;
  let dimensions = 0;
  let recommendations = 0;
  let events = 0;
  let outcomes = 0;
  let digestsWritten = 0;
  let scansCompacted = 0;
  let digestsWouldWrite: number | null = null;
  // ONE definition of "which scans are in scope", used by BOTH the delete selection below and the
  // preview count (data-retention 07-16 #20). A preview computed from a SECOND, separately-written
  // predicate is worse than no preview at all: it licenses an irreversible act with a number that can
  // silently drift from what the delete will actually remove. Keeping the two in the same function,
  // reading the same `where`, is what makes "the number you were shown is the number that dies" true.
  const where = { repoId } satisfies Prisma.ScanWhereInput;
  if (countOnly) {
    // Preview: how many scans fall OUTSIDE the keep-window (`max`); an erase passes max = 0, so it is
    // the repo's whole scan count. Dependent dimension/recommendation(-event) rows are NOT enumerated
    // (reported 0), matching purgeExpiredData's dry run — the scan count is the decision-relevant
    // number, and counting three more tables per repo would triple a preview's cost for no new decision.
    const total = await prisma.scan.count({ where });
    const stale = Math.max(0, total - max);
    if (compact && stale > 0) digestsWouldWrite = await previewDigestKeys(prisma, where, max, stale, batchSize);
    return {
      scans: stale,
      dimensions: 0,
      recommendations: 0,
      events: 0,
      outcomes: 0,
      digestsWritten: 0,
      scansCompacted: 0,
      digestsWouldWrite,
    };
  }
  // Page the SELECTION too, not just the deletes. The prior code did one UNBOUNDED findMany(skip:max)
  // pulling every stale id into memory before the batched delete loop — on a long-watched repo with a
  // huge per-commit scan history that single read can hit a DSQL statement timeout / memory pressure
  // and abort the whole prune, so the table the job exists to bound keeps growing. Re-`skip: max` each
  // page (always keep the newest `max`); the prior page's rows are now deleted, so `skip:max` advances
  // to the next stale window. Stop when a page is short. Rank by DB-authoritative `createdAt` (insertion
  // order), NOT report `scannedAt`: a backdated/skewed scannedAt could otherwise drop a live newer scan.
  // deleteInPages owns the short-page/empty-page/zero-progress termination (the `counts.sc === 0` guard).
  // The page the digest fold reads, captured by the selector for the deleter below. Only populated
  // when `compact` — with compaction off the select is byte-for-byte the `{ id: true }` it always was.
  let foldPage: DigestInputScan[] = [];
  await deleteInPages(
    async () => {
      const order = [{ createdAt: "desc" as const }, { id: "desc" as const }];
      if (!compact) {
        return (
          await prisma.scan.findMany({ where, orderBy: order, skip: max, take: batchSize, select: { id: true } })
        ).map((s) => s.id);
      }
      const rows = await prisma.scan.findMany({
        where,
        orderBy: order,
        skip: max,
        take: batchSize,
        select: DIGEST_SCAN_SELECT,
      });
      foldPage = rows.map(toDigestInput);
      return rows.map((s) => s.id);
    },
    async (ids) => {
      // Computed OUTSIDE the transaction but re-read INSIDE it (upsertDigests does its own
      // findUnique), so a conflict retry re-merges against whatever the winning tick committed.
      const drafts = compact ? digestScans(foldPage) : [];
      // Delete the whole scan sub-graph for this batch in ONE transaction so a mid-batch timeout can't
      // leave a half-deleted graph. relationMode = "prisma" emits no FK cascade, so the grandchildren
      // (RecommendationEvent) must be deleted BEFORE their parent Recommendation or they orphan forever.
      // Order: grandchildren (events) → children (dimensions, recommendations, outcomes) → parent (scan).
      const counts = await withRetry(
        () =>
          prisma.$transaction(async (tx) => {
            // MOONSHOT #32 — the fold is committed by the SAME transaction as the deletes that
            // remove its inputs. That, and nothing else, is what makes it idempotent: a retried
            // batch rolls back both halves and re-selects only surviving rows, so no scan can be
            // folded twice and none can die without its summary. A fold written outside this
            // transaction would survive an aborted delete and double-count on the retry.
            const dg = drafts.length ? await upsertDigests(tx, repoId, drafts) : 0;
            const recIds = (
              await tx.recommendation.findMany({ where: { scanId: { in: ids } }, select: { id: true } })
            ).map((r) => r.id);
            const ev = recIds.length
              ? (await tx.recommendationEvent.deleteMany({ where: { recommendationId: { in: recIds } } })).count
              : 0;
            const dim = (await tx.scanDimension.deleteMany({ where: { scanId: { in: ids } } })).count;
            const rec = (await tx.recommendation.deleteMany({ where: { scanId: { in: ids } } })).count;
            // MOONSHOT #9. An InterventionOutcome is a MEASUREMENT pinned to two scan bookends: it
            // only exists because both scans existed and agreed on the instrument. Once either
            // bookend is purged the row can no longer be re-derived, re-verified, or audited — it
            // becomes an unfalsifiable claim of lift with nothing behind it, which for a measurement
            // ledger is worse than an absent row. It is NOT scan-id-shaped debris to be swept later:
            // it dies with its evidence, inside the same transaction, so no window exists in which
            // the aggregate reads a delta whose scans are already gone.
            const out = (
              await tx.interventionOutcome.deleteMany({
                where: { OR: [{ beforeScanId: { in: ids } }, { afterScanId: { in: ids } }] },
              })
            ).count;
            const sc = (await tx.scan.deleteMany({ where: { id: { in: ids } } })).count;
            return { ev, dim, rec, out, sc, dg };
          }),
        { label: "retention.prune-scans" },
      );
      events += counts.ev;
      dimensions += counts.dim;
      recommendations += counts.rec;
      outcomes += counts.out;
      scans += counts.sc;
      digestsWritten += counts.dg;
      if (compact) scansCompacted += counts.sc;
      return counts.sc; // progress count → zero stops the loop (a delete that removed no scan rows)
    },
    batchSize,
    budgetExceeded, // stop between batches once the run is over budget (data-retention #1)
  );
  return { scans, dimensions, recommendations, events, outcomes, digestsWritten, scansCompacted, digestsWouldWrite };
}

/** Map a widened page row to the fold's input shape (the rec statuses collapse to two counters). */
function toDigestInput(s: {
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
  rubricVersion: string | null;
  engineProvider: string;
  engineModel: string;
  dimensions: { dimId: string; score: number; signalScore: number; llmScore: number }[];
  recommendations: { status: string }[];
}): DigestInputScan {
  return {
    ...s,
    dimensions: s.dimensions,
    // "Opened" is every recommendation the scan raised; "closed" is the ones that were resolved. A
    // dismissed rec is neither work done nor work outstanding, so it counts only in the opened total.
    recsOpened: s.recommendations.length,
    recsClosed: s.recommendations.filter((r) => r.status === "done").length,
  };
}

/**
 * Dry-run preview of how many digest ROWS a fold would touch, over the same paged stale window the
 * delete selection walks — three narrow columns, no dimensions, no recommendations.
 *
 * Past {@link DIGEST_PREVIEW_MAX_SCANS} it returns `null` (unknown) rather than extrapolating: a
 * preview's whole value is that the number shown is the number that happens, and an estimate quietly
 * breaks that. The SCAN count is unaffected — it still comes from the single shared `where`.
 */
async function previewDigestKeys(
  prisma: PrismaLike,
  where: Prisma.ScanWhereInput,
  max: number,
  stale: number,
  batchSize: number,
): Promise<number | null> {
  if (stale > DIGEST_PREVIEW_MAX_SCANS) return null;
  const keys = new Set<string>();
  for (let seen = 0; seen < stale; seen += batchSize) {
    const rows = await prisma.scan.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // Nothing is deleted in a preview, so the window is advanced by hand rather than by the
      // shrinking table the real loop relies on.
      skip: max + seen,
      take: Math.min(batchSize, stale - seen),
      select: { scannedAt: true, rubricVersion: true, engineProvider: true },
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      keys.add(`${digestPeriod(r.scannedAt)} ${r.rubricVersion ?? UNKNOWN_RUBRIC} ${r.engineProvider}`);
    }
  }
  return keys.size;
}

/**
 * Batched delete over one AUDIT-SHAPED wave-1 ledger (moonshot #11 / #16), oldest first.
 *
 * These two tables are aged on `Organization.retentionAuditDays`, NOT on the scan keep-window, and
 * that choice is deliberate: a `UsageEvent` is a billing/telemetry record of an inference this
 * deployment served and a `ConformanceReport` is a control attestation a repo sent back — both are
 * records of what HAPPENED, like an AuditLog row, and neither is a derivative of a scan that a
 * scan-count window could sensibly bound. Sharing `pruneAudit`'s horizon means an operator has ONE
 * number to reason about for "how long do we keep the evidence", instead of three.
 *
 * Generic over the delegate so the caller supplies the finder/deleter pair; the paging, the
 * budget yield and the conflict retry are the same ones every other sweep in this module uses.
 */
async function pruneAgedLedger(
  find: (take: number) => Promise<{ id: string }[]>,
  del: (ids: string[]) => Promise<number>,
  batchSize: number,
  budgetExceeded?: () => boolean,
): Promise<number> {
  let total = 0;
  await deleteInPages(
    async () => (await find(batchSize)).map((r) => r.id),
    async (ids) => {
      const count = await del(ids);
      total += count;
      return count;
    },
    batchSize,
    budgetExceeded,
  );
  return total;
}

/**
 * MOONSHOT #10 — retire SETTLED queue rows older than {@link SCAN_JOB_RETENTION_DAYS}.
 *
 * Deliberately NOT org-scoped and NOT gated on a retention policy: the per-org loop below skips any
 * org whose windows are both 0 (the documented "retention is opt-in" behaviour), and a queue that
 * only drains for orgs that happen to have configured retention is a queue that grows without bound
 * on every other deployment. The horizon is a constant, so one predicate over the whole table is
 * both correct and cheaper than one query per org.
 *
 * `settledAt` is the anchor rather than `createdAt`: a job that took a week to reach `done` should be
 * kept for 30 days after it FINISHED, not after it was enqueued. A row whose `settledAt` is null is
 * never matched — it has not settled, so it is live work and the lease, not retention, governs it.
 */
async function pruneSettledScanJobs(
  prisma: PrismaLike,
  cutoff: Date,
  batchSize: number,
  budgetExceeded: () => boolean,
): Promise<number> {
  return pruneAgedLedger(
    (take) =>
      prisma.scanJob.findMany({
        where: { state: { in: [...SCAN_JOB_SETTLED_STATES] }, settledAt: { lt: cutoff } },
        orderBy: { settledAt: "asc" },
        take,
        select: { id: true },
      }),
    async (ids) =>
      (
        await withRetry(() => prisma.scanJob.deleteMany({ where: { id: { in: ids } } }), {
          label: "retention.prune-scan-jobs",
        })
      ).count,
    batchSize,
    budgetExceeded,
  );
}

/**
 * MOONSHOT #1 — age the control ledger out on the org's `auditDays` horizon, ALWAYS keeping the
 * newest observation of every `(repoFullName, controlId)` pair.
 *
 * The keep-newest rule is the whole design. A `ControlObservation` is append-only and the posture
 * surfaces read the LATEST row per pair, so a plain date sweep would delete the current standing of
 * every control an org has not re-observed inside the window — and the read layer, finding no row,
 * would report `unmeasurable`. Retention would then have manufactured a governance finding: "we
 * cannot see your branch protection" for a repo whose branch protection has been on, unchanged and
 * observed, the entire time. Evidence ages out; the current fact does not.
 *
 * The survivor is excluded in the PREDICATE (`id: { not: newest }`) rather than filtered out of a
 * selected page, so every page this sweep reads is deletable and the loop always makes progress —
 * `deleteInPages` stops on a zero-progress batch, and a page that happened to be all survivors would
 * otherwise end the sweep early and silently.
 *
 * `countOnly` is the dry-run path: it counts over the SAME per-pair predicate the delete uses, so the
 * preview is the number of rows the confirmed run removes.
 */
async function pruneControlObservations(
  prisma: PrismaLike,
  orgId: string,
  cutoff: Date,
  batchSize: number,
  budgetExceeded: () => boolean,
  countOnly: boolean,
): Promise<number> {
  // One group per (repo, control) the org has ever observed. Bounded by repos × catalogue controls,
  // which is the same order as the repo enumeration the scan prune already walks.
  const pairs = await prisma.controlObservation.groupBy({
    by: ["repoFullName", "controlId"],
    where: { orgId },
  });

  let total = 0;
  for (const pair of pairs) {
    if (budgetExceeded()) break;
    // `id` breaks the tie so two rows sharing a timestamp cannot BOTH be treated as the survivor
    // (which would keep one and delete the other, or keep neither, depending on page order).
    const newest = await prisma.controlObservation.findFirst({
      where: { orgId, repoFullName: pair.repoFullName, controlId: pair.controlId },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const where: Prisma.ControlObservationWhereInput = {
      orgId,
      repoFullName: pair.repoFullName,
      controlId: pair.controlId,
      observedAt: { lt: cutoff },
      ...(newest ? { id: { not: newest.id } } : {}),
    };
    if (countOnly) {
      total += await prisma.controlObservation.count({ where });
      continue;
    }
    total += await pruneAgedLedger(
      (take) =>
        prisma.controlObservation.findMany({ where, orderBy: { observedAt: "asc" }, take, select: { id: true } }),
      async (ids) =>
        (
          await withRetry(() => prisma.controlObservation.deleteMany({ where: { id: { in: ids } } }), {
            label: "retention.prune-control-observations",
          })
        ).count,
      batchSize,
      budgetExceeded,
    );
  }
  return total;
}

/** Batched delete of audit entries matching `where` (oldest first), DSQL-friendly. */
async function pruneAudit(
  prisma: PrismaLike,
  where: Prisma.AuditLogWhereInput,
  batchSize: number,
  budgetExceeded?: () => boolean,
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
    budgetExceeded, // a large audit sweep must also yield between batches (data-retention #1)
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
  /** InterventionOutcome rows that died with their scan bookends (moonshot #9). Not enumerated in a
   *  dry run (0), for the same reason dimensions/recommendations aren't. */
  outcomesDeleted: number;
  /** UsageEvent rows aged out on the org's `retentionAuditDays` horizon (moonshot #11). */
  usageEventsDeleted: number;
  /** ConformanceReport rows aged out on the same horizon (moonshot #16). */
  conformanceReportsDeleted: number;
  /** ConformanceFinding rows removed with those reports — deleted BEFORE their parent by hand: the
   *  schema's onDelete: Cascade is client-side emulation that a bulk deleteMany does not run. */
  conformanceFindingsDeleted: number;
  /** MOONSHOT #17 — `OrgMemoryCitation` rows aged out on the same audit horizon. A citation is an
   *  EVENT ("this agent used this memory in this session"), so it ages like the meter and the
   *  control ledger; the denormalized `OrgMemory.citedCount` is the surviving standing figure and is
   *  deliberately NOT decremented — the count records that the memory was used, and rewriting it
   *  when the evidence ages out would make a memory look progressively less used over time. */
  memoryCitationsDeleted: number;
  /** MOONSHOT #1 — `ControlObservation` rows aged out on the same audit horizon, never including the
   *  newest row of a `(repoFullName, controlId)` pair. `ControlLedgerSeal` has no counterpart here on
   *  purpose: a sealed day keeps its seal after its rows are gone, so a deleted window stays
   *  DETECTABLE (the surviving rows no longer reproduce the day's root) instead of looking like a day
   *  on which nothing was observed. See {@link pruneControlObservations}. */
  controlObservationsDeleted: number;
  /** MOONSHOT #32 — `ScanDigest` rows created or updated by the fold. The compliance trace has to
   *  say what SURVIVED, not only what died: these are the summaries the deleted scans became. */
  digestsWritten: number;
  /** Scans that were folded into a digest before they were deleted (0 when compaction is off). */
  scansCompacted: number;
  /** Digest rows aged out past `retentionDigestMonths` (0 = keep digests forever, so no sweep). */
  digestsDeleted: number;
  /** Dry run only: digest rows the fold would touch, or `null` when the stale window is past the
   *  preview cap. `null` is "we did not count", never "none" — see {@link previewDigestKeys}. */
  digestsWouldWrite: number | null;
}

/** Roll-up of a full purge run across every org. */
export interface PurgeSummary {
  orgsProcessed: number;
  scansDeleted: number;
  dimensionsDeleted: number;
  recommendationsDeleted: number;
  recommendationEventsDeleted: number;
  auditDeleted: number;
  outcomesDeleted: number;
  usageEventsDeleted: number;
  conformanceReportsDeleted: number;
  conformanceFindingsDeleted: number;
  memoryCitationsDeleted: number;
  controlObservationsDeleted: number;
  /** MOONSHOT #10 — settled `ScanJob` rows retired on the fixed {@link SCAN_JOB_RETENTION_DAYS}
   *  horizon. A FLEET-WIDE figure with no per-org row behind it: the sweep is one predicate over the
   *  whole queue precisely because it is not governed by any org's policy. */
  scanJobsDeleted: number;
  digestsWritten: number;
  scansCompacted: number;
  digestsDeleted: number;
  /** Dry run only. `null` when ANY repo's window was past the preview cap: one unknown makes the
   *  fleet total unknown, and a partial sum presented as a total is the failure the cap exists for. */
  digestsWouldWrite: number | null;
  results: OrgPurgeResult[];
  errors: string[];
  /** True when the wall-clock budget stopped the run before every org/sweep was reached this tick — a
   *  partial run (data-retention #2). The next tick re-shuffles and resumes the unreached orgs. */
  stoppedEarly: boolean;
  /** Orgs left unprocessed when the run stopped early (0 on a complete run) — the resume tail. */
  orgsRemaining: number;
  /** True when this was a preview run: nothing was deleted and no audit entry was written. Scan
   *  counts are per-repo would-delete totals; dependent dimension/recommendation(-event) rows are NOT
   *  enumerated in a dry run (reported as 0) — the scan count is the decision-relevant number. */
  dryRun: boolean;
}

/** Options for {@link purgeExpiredData}. The clock is injectable so the budget + the per-tick rotation
 *  (which is DERIVED from the clock, not from an RNG) are deterministically testable. */
export interface PurgeOptions {
  actorId?: string;
  /** Wall-clock budget (ms) for the org loop; defaults to the RETENTION_TIME_BUDGET_MS env var, then
   *  RETENTION_DEFAULT_TIME_BUDGET_MS. `0` = unlimited (no budget), per the module's 0-sentinel. */
  timeBudgetMs?: number;
  /** Monotonic-ish clock (ms). Defaults to Date.now. Also seeds the per-tick rotation offset. */
  now?: () => number;
  /** Preview mode (data-retention 07-16 #2): count what each policy WOULD delete without deleting
   *  anything or writing audit entries. Surfaced as `?dryRun=1` on /api/cron/purge. The safety floor
   *  is not enforced in a dry run (previewing a sub-floor policy is exactly what it is for). */
  dryRun?: boolean;
}

/**
 * Rotate a STABLY-ordered list in place by `offset` positions (data-retention #4). Replaces the old
 * Fisher-Yates RANDOM shuffle: a stateless random shuffle only gives PROBABILISTIC fairness — a large
 * org that can't drain within one tick's budget has an independent chance of landing in the unreached
 * tail EVERY run, so it can be starved for an unbounded number of ticks (bad luck compounds). A
 * DETERMINISTIC round-robin rotation of the fixed oldest-first order instead advances the starting point
 * by one org per day (offset = epoch-day index) and wraps, so every org reaches the front within
 * `length` ticks — a BOUNDED worst-case reach — while staying stateless (no persisted cursor). The input
 * order is the query's `createdAt asc` (oldest first), so an un-rotated tick already drains the oldest
 * data first; the rotation only guarantees the tail is eventually reached.
 *
 * PRECONDITIONS the bound depends on (data-retention 07-16 #3) — neither is checked at runtime:
 *  1. EXACTLY ONE tick per calendar day. The offset is `floor(startedAt / DAY_MS)` (the epoch-day
 *     index), so it advances once per day regardless of cron cadence: schedule the purge more often
 *     than daily (vercel.json is the source of truth, not the route's "daily" comment) and every tick
 *     within a day retries the identical prefix — the bound becomes `length` DAYS, not ticks.
 *  2. A STABLE org population. The modulo is over `orgs.length`, so an org created/deleted between
 *     ticks changes `n` and `offset % n` jumps discontinuously — during org churn the round-robin
 *     bound degrades to probabilistic again and an unlucky tail org can be skipped repeatedly.
 * Under churn/steeper cadence the guarantee is best-effort, not broken-by-construction: every tick
 * still drains oldest-first from wherever it starts. The durable fix — a persisted cursor row — was
 * REJECTED to keep this module schema-free and stateless (no migration, no cursor row to corrupt or
 * to contend on under concurrent ticks); revisit if real deployments schedule sub-daily crons.
 */
export function rotateForTick<T>(arr: T[], offset: number): void {
  const n = arr.length;
  if (n <= 1) return;
  const k = ((Math.trunc(offset) % n) + n) % n; // normalize into [0, n), tolerating negatives
  if (k === 0) return;
  const rotated = arr.slice(k).concat(arr.slice(0, k));
  for (let i = 0; i < n; i++) arr[i] = rotated[i]!;
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
  const envBudget = opts.timeBudgetMs == null ? parseNonNegInt(process.env.RETENTION_TIME_BUDGET_MS) : null;
  // `??`, not `||` (data-retention 07-16 #5): everywhere else in this module 0 is the documented
  // "disabled/unlimited" sentinel, but falsy-coalescing silently swallowed an explicit
  // RETENTION_TIME_BUDGET_MS=0 into the 250s default — leaving no way to express "no budget" at all.
  // 0 now means unlimited (overBudget below never trips); unset/invalid still gets the derived default.
  const timeBudgetMs = opts.timeBudgetMs ?? envBudget ?? RETENTION_DEFAULT_TIME_BUDGET_MS;
  // Budget/cap coupling warning (data-retention 07-16 #1): a budget at or beyond the route's declared
  // maxDuration can never trip BEFORE the platform kill, so the "stop cleanly with a summary" guarantee
  // is silently void. Warn (env-configured budgets only — injected test budgets are deliberate; an
  // explicit 0 = unlimited is likewise a deliberate operator choice, not an accidental over-cap).
  if (envBudget != null && envBudget !== 0 && envBudget >= PURGE_MAX_DURATION_S * 1000) {
    console.warn(
      `[retention] RETENTION_TIME_BUDGET_MS=${envBudget} >= the route's maxDuration (${PURGE_MAX_DURATION_S}s) — ` +
        `the budget will never trip before the platform kills the function; set it below the plan's real cap`,
    );
  }
  const startedAt = now();

  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      slug: true,
      retentionMaxScans: true,
      retentionAuditDays: true,
      // MOONSHOT #32 — resolved ONCE per org and passed down, so the fold decision is made in one
      // place and every repo of the org is pruned under the same policy.
      retentionCompact: true,
      retentionDigestMonths: true,
    },
    // Stable ordering so the run is deterministic and the per-run rotation below has a fixed point to
    // rotate from; without an explicit orderBy the DB row order is undefined (no cursor to resume from).
    orderBy: { createdAt: "asc" },
  });

  // Tail-org starvation guard (data-retention #2 + #4): the run is strictly sequential under the route's
  // 300s maxDuration, and with a STABLE org order a large fleet that can't drain in one tick dies at the
  // same prefix every run — so late-ordered orgs are NEVER reached and their retention is never enforced
  // (the exact failure this module exists to prevent), worst for the biggest fleets. Two cheap,
  // schema-free defenses, combined: (1) rotate the order each tick with a DETERMINISTIC round-robin
  // (offset = epoch-day index) so every org reaches the front within `orgs.length` ticks — a BOUNDED
  // reach, unlike the old random shuffle whose fairness was only probabilistic (a large org could be
  // unlucky run after run), and (2) stop cleanly once a wall-clock budget is exhausted — before the
  // platform kills the function mid-delete — surfacing the unreached count so the route's non-2xx
  // alerting (finding #1) trips. The offset is seeded from `startedAt` (already read from the injectable
  // clock) so it consumes no extra now() tick.
  rotateForTick(orgs, Math.floor(startedAt / DAY_MS));

  const results: OrgPurgeResult[] = [];
  const errors: string[] = [];
  let stoppedEarly = false;
  let orgsRemaining = 0;

  // Soft wall-clock budget: bail cleanly BEFORE the platform hard-kills the function at maxDuration, so
  // this run returns a partial (but visible + resumable) summary instead of dying mid-delete with no
  // log. Committed batches survive; the next tick's re-shuffle reaches the unprocessed tail. Also
  // governs the trailing org-less / public-scan-quota sweeps below.
  // timeBudgetMs === 0 is the "unlimited" sentinel (data-retention 07-16 #5): never over budget.
  const overBudget = () => timeBudgetMs > 0 && now() - startedAt >= timeBudgetMs;

  // Count only the orgs from `from` onward that actually have a policy to enforce (data-retention #6):
  // an org whose effective window is 0/0 is skipped as a no-op below, so counting it as "unprocessed"
  // over-states the resume tail and inflates the `(budget):` message — an operator reads N orgs left
  // when most do nothing. The next tick would skip them instantly anyway, so they aren't real work.
  const configuredRemaining = (from: number) =>
    orgs.slice(from).reduce((n, o) => {
      const p = resolveRetention(defaults, o);
      return n + (p.maxScansPerRepo > 0 || p.auditDays > 0 ? 1 : 0);
    }, 0);

  for (let i = 0; i < orgs.length; i++) {
    if (overBudget()) {
      stoppedEarly = true;
      orgsRemaining = configuredRemaining(i);
      errors.push(
        `(budget): retention stopped after ${Math.round((now() - startedAt) / 1000)}s with ${orgsRemaining} org(s) unprocessed this tick`,
      );
      break;
    }
    const org = orgs[i]!; // safe: i < orgs.length
    const policy = resolveRetention(defaults, org);
    // MOONSHOT #32. Off unless this org (or the deployment) asked for it: with `compact: false` the
    // page SELECT, the transaction and the counts below are exactly what they were before compaction
    // existed — which is what makes "an existing deployment's purge is unchanged" a fact, not a hope.
    const compaction = resolveCompaction(org);
    // Nothing to enforce for this org — skip (don't write a no-op audit entry).
    if (policy.maxScansPerRepo <= 0 && policy.auditDays <= 0) continue;

    // Safety floor (data-retention 07-16 #2): refuse to DESTRUCTIVELY apply a configured window below
    // the floor — a single mistyped integer must not silently wipe an org's compliance evidence. The
    // error trips the route's 207 so an operator is paged instead of the data quietly vanishing.
    // Dry runs preview sub-floor policies unimpeded; RETENTION_FORCE=1 applies them for real.
    if (!opts.dryRun && process.env.RETENTION_FORCE !== "1") {
      const belowFloor: string[] = [];
      if (policy.maxScansPerRepo > 0 && policy.maxScansPerRepo < RETENTION_MIN_SCANS_PER_REPO) {
        belowFloor.push(`maxScansPerRepo=${policy.maxScansPerRepo} < ${RETENTION_MIN_SCANS_PER_REPO}`);
      }
      if (policy.auditDays > 0 && policy.auditDays < RETENTION_MIN_AUDIT_DAYS) {
        belowFloor.push(`auditDays=${policy.auditDays} < ${RETENTION_MIN_AUDIT_DAYS}`);
      }
      if (belowFloor.length) {
        errors.push(
          `${org.slug}: retention policy is below the safety floor (${belowFloor.join(", ")}); refusing to purge ` +
            `this org. Preview with ?dryRun=1; set RETENTION_FORCE=1 to apply an intentionally aggressive policy.`,
        );
        continue;
      }
    }

    // Declare the counters OUTSIDE the try (data-retention #3). Each delete batch is its own committed
    // transaction, so if a LATER batch/sweep throws, earlier batches are already durable — the counters
    // hold real deletions. The old code declared these inside try and only results.push()'d at the very
    // end, so ANY throw mid-prune discarded the org's already-committed counts: the run summary (and the
    // rolled-up totals the compliance view reads) then UNDER-reported what was actually deleted. Hoisting
    // them lets the catch below record the PARTIAL result instead of dropping it.
    let scansDeleted = 0;
    let dimensionsDeleted = 0;
    let recommendationsDeleted = 0;
    let recommendationEventsDeleted = 0;
    let auditDeleted = 0;
    let outcomesDeleted = 0;
    let usageEventsDeleted = 0;
    let conformanceReportsDeleted = 0;
    let conformanceFindingsDeleted = 0;
    let memoryCitationsDeleted = 0;
    let controlObservationsDeleted = 0;
    let digestsWritten = 0;
    let scansCompacted = 0;
    let digestsDeleted = 0;
    let digestsWouldWrite: number | null = compaction.compact && opts.dryRun ? 0 : null;

    try {
      // Preview mode (data-retention 07-16 #2): count what the policy WOULD delete — per-repo scan
      // counts beyond the keep-window plus in-window audit rows — with no deletes, no transactions,
      // and no self-audit entry. Dependent dimension/recommendation rows are not enumerated (0).
      if (opts.dryRun) {
        if (policy.maxScansPerRepo > 0) {
          const perRepo = await prisma.scan.groupBy({
            by: ["repoId"],
            where: { repo: { orgId: org.id } },
            _count: { _all: true },
          });
          for (const row of perRepo) scansDeleted += Math.max(0, row._count._all - policy.maxScansPerRepo);
          // MOONSHOT #32 — what the fold would WRITE, over the same per-repo stale window the scan
          // count above is derived from. One repo past the cap makes the org's figure unknown: a
          // partial sum shown as a total is exactly the reassurance the cap exists to refuse.
          if (compaction.compact) {
            for (const row of perRepo) {
              const stale = Math.max(0, row._count._all - policy.maxScansPerRepo);
              if (stale === 0) continue;
              const keys = await previewDigestKeys(
                prisma,
                { repoId: row.repoId },
                policy.maxScansPerRepo,
                stale,
                policy.batchSize,
              );
              digestsWouldWrite = keys == null || digestsWouldWrite == null ? null : digestsWouldWrite + keys;
            }
          }
        }
        if (policy.auditDays > 0) {
          const cutoff = new Date(now() - policy.auditDays * DAY_MS);
          auditDeleted = await prisma.auditLog.count({ where: { orgId: org.id, at: { lt: cutoff } } });
          // Counted over the SAME predicates the real sweeps below use, so the preview is the number
          // that dies. Findings are NOT enumerated (0) — like dimensions/recommendations, they are a
          // dependent row count that would triple the preview's cost for no new decision.
          usageEventsDeleted = await prisma.usageEvent.count({
            where: { orgId: org.id, createdAt: { lt: cutoff } },
          });
          conformanceReportsDeleted = await prisma.conformanceReport.count({
            where: { orgId: org.id, reportedAt: { lt: cutoff } },
          });
          // MOONSHOT #17 — counted, not skipped as a dependent row would be: a citation is a
          // standalone event with its own predicate, and spec 17 asks for it in the COUNTED preview
          // precisely so an operator can see the use-evidence a purge is about to remove.
          memoryCitationsDeleted = await prisma.orgMemoryCitation.count({
            where: { orgId: org.id, createdAt: { lt: cutoff } },
          });
          // MOONSHOT #1 — counted over the SAME per-pair predicate the real sweep deletes on, so the
          // preview excludes each pair's surviving newest row exactly like the confirmed run does. An
          // operator approving a purge of governance evidence is reading this number.
          controlObservationsDeleted = await pruneControlObservations(
            prisma,
            org.id,
            cutoff,
            policy.batchSize,
            overBudget,
            true,
          );
        }
        results.push({
          orgSlug: org.slug,
          policy,
          scansDeleted,
          dimensionsDeleted,
          recommendationsDeleted,
          recommendationEventsDeleted,
          auditDeleted,
          outcomesDeleted,
          usageEventsDeleted,
          conformanceReportsDeleted,
          conformanceFindingsDeleted,
          memoryCitationsDeleted,
          controlObservationsDeleted,
          digestsWritten,
          scansCompacted,
          digestsDeleted,
          digestsWouldWrite,
        });
        continue;
      }

      // Set once the wall-clock budget trips WHILE this org is being pruned (data-retention #1). The
      // budget used to be polled only between orgs, so the one fleet org it exists to protect — thousands
      // of repos, huge scan histories — ran its entire delete loop past maxDuration and was hard-killed
      // mid-delete with no summary and no alert. We now poll inside the repo loop (and inside
      // pruneRepoScans/pruneAudit) and, on a trip, stop at the next repo/batch boundary. Committed batches
      // are durable, so this org's partial deletes are safe/resumable on the next (re-shuffled) tick.
      let budgetStopped = false;

      if (policy.maxScansPerRepo > 0) {
        // Page the repo enumeration with a stable id cursor (data-retention #5): the prior single
        // unbounded findMany pulled EVERY repo id for the org into memory at once — a fleet org
        // watching thousands of repos is a large read that compounds the timeout/memory exposure the
        // scan SELECT was already paged to avoid. Fetch a bounded page, prune it, advance past the
        // last id; stop on a short page. Keep per-repo pruning serial so DSQL conflict pressure stays
        // bounded (each prune is itself batched + retry-on-conflict).
        let repoCursor: string | undefined;
        repoPages: for (;;) {
          const repos = await prisma.repository.findMany({
            where: { orgId: org.id },
            orderBy: { id: "asc" },
            select: { id: true },
            take: REPO_PAGE_SIZE,
            ...(repoCursor ? { cursor: { id: repoCursor }, skip: 1 } : {}),
          });
          if (repos.length === 0) break;
          for (const repo of repos) {
            // Poll the budget BETWEEN repos (data-retention #1): stop before starting another repo's
            // prune once the budget is spent, so a mega-org yields control instead of being hard-killed.
            // The scans already deleted this tick stand; the unreached repos resume next tick.
            if (overBudget()) {
              budgetStopped = true;
              break repoPages;
            }
            const r = await pruneRepoScans(
              prisma,
              repo.id,
              policy.maxScansPerRepo,
              policy.batchSize,
              overBudget,
              false,
              compaction.compact,
            );
            scansDeleted += r.scans;
            dimensionsDeleted += r.dimensions;
            recommendationsDeleted += r.recommendations;
            recommendationEventsDeleted += r.events;
            outcomesDeleted += r.outcomes;
            digestsWritten += r.digestsWritten;
            scansCompacted += r.scansCompacted;
            // Digest retention (MOONSHOT #32), after this repo's scan prune. Gated on the horizon
            // ALONE, not on `compact`: an org that turned compaction off still has digests, and they
            // must keep ageing out. `0` = keep them forever, so there is no call at all.
            if (compaction.digestMonths > 0) {
              digestsDeleted += await pruneDigests(
                prisma,
                repo.id,
                monthsBefore(new Date(now()), compaction.digestMonths),
                policy.batchSize,
                overBudget,
              );
            }
          }
          if (repos.length < REPO_PAGE_SIZE) break;
          repoCursor = repos[repos.length - 1]!.id;
        }
      }

      // Skip this org's audit sweep if the scan prune already exhausted the budget; run it otherwise,
      // and treat a budget-interrupted (partial) sweep as a mid-org stop too (data-retention #1).
      if (!budgetStopped && policy.auditDays > 0) {
        const cutoff = new Date(now() - policy.auditDays * DAY_MS);
        auditDeleted = await pruneAudit(prisma, { orgId: org.id, at: { lt: cutoff } }, policy.batchSize, overBudget);
        if (overBudget()) budgetStopped = true;

        // MOONSHOT #11 — the LLM meter. One row per metered inference leg, so this table grows with
        // TRAFFIC rather than with the fleet: an org whose scans are all inside the keep-window can
        // still accumulate millions of rows the scan prune never reaches. Aged on the audit horizon
        // (see pruneAgedLedger's header for why that horizon and not the scan one).
        if (!budgetStopped) {
          usageEventsDeleted = await pruneAgedLedger(
            (take) =>
              prisma.usageEvent.findMany({
                where: { orgId: org.id, createdAt: { lt: cutoff } },
                orderBy: { createdAt: "asc" },
                take,
                select: { id: true },
              }),
            async (ids) =>
              (
                await withRetry(() => prisma.usageEvent.deleteMany({ where: { id: { in: ids } } }), {
                  label: "retention.prune-usage-events",
                })
              ).count,
            policy.batchSize,
            overBudget,
          );
          if (overBudget()) budgetStopped = true;
        }

        // MOONSHOT #16 — the doctor per-check ledger. Findings are deleted BEFORE their report in the
        // SAME transaction: `onDelete: Cascade` on ConformanceFinding.report is Prisma CLIENT-side
        // emulation (relationMode = "prisma" emits no FK), and the client only runs it for deletes it
        // can resolve to parent rows — a bulk deleteMany like this one does not, so an unassisted
        // report sweep would orphan every finding permanently. The order is the same delete-graph
        // convention pruneRepoScans follows: children, then parent.
        if (!budgetStopped) {
          conformanceReportsDeleted = await pruneAgedLedger(
            (take) =>
              prisma.conformanceReport.findMany({
                where: { orgId: org.id, reportedAt: { lt: cutoff } },
                orderBy: { reportedAt: "asc" },
                take,
                select: { id: true },
              }),
            async (ids) => {
              const counts = await withRetry(
                () =>
                  prisma.$transaction(async (tx) => {
                    const findings = (
                      await tx.conformanceFinding.deleteMany({ where: { reportId: { in: ids } } })
                    ).count;
                    const reports = (await tx.conformanceReport.deleteMany({ where: { id: { in: ids } } })).count;
                    return { findings, reports };
                  }),
                { label: "retention.prune-conformance" },
              );
              conformanceFindingsDeleted += counts.findings;
              return counts.reports;
            },
            policy.batchSize,
            overBudget,
          );
          if (overBudget()) budgetStopped = true;
        }

        // MOONSHOT #17 — the memory citation channel. Like the meter, this table grows with AGENT
        // TRAFFIC rather than with the fleet, so an org whose scans all sit inside the keep-window
        // can still accumulate citations the scan prune never reaches. Aged on the audit horizon.
        // `OrgMemory.citedCount` is deliberately left alone: it records that the memory WAS used,
        // and decrementing it as evidence ages would make a well-used memory decay into an
        // apparently-unused one — a number that gets quietly less true the longer it survives.
        if (!budgetStopped) {
          memoryCitationsDeleted = await pruneAgedLedger(
            (take) =>
              prisma.orgMemoryCitation.findMany({
                where: { orgId: org.id, createdAt: { lt: cutoff } },
                orderBy: { createdAt: "asc" },
                take,
                select: { id: true },
              }),
            async (ids) =>
              (
                await withRetry(() => prisma.orgMemoryCitation.deleteMany({ where: { id: { in: ids } } }), {
                  label: "retention.prune-memory-citations",
                })
              ).count,
            policy.batchSize,
            overBudget,
          );
          if (overBudget()) budgetStopped = true;
        }

        // MOONSHOT #1 — the control ledger, on the same audit horizon as the meter and the citations,
        // and for the same reason: an observation records what HAPPENED, like an AuditLog row, and is
        // not a derivative of a scan that a scan-count window could bound. The one difference is the
        // keep-newest rule — see pruneControlObservations for why ageing out a pair's last row would
        // manufacture an "unmeasurable" finding out of a control that has been on the whole time.
        // ControlLedgerSeal is deliberately NOT swept: a sealed day whose rows have aged out must keep
        // its seal, so a deleted window is DETECTABLE rather than indistinguishable from a quiet day.
        if (!budgetStopped) {
          controlObservationsDeleted = await pruneControlObservations(
            prisma,
            org.id,
            cutoff,
            policy.batchSize,
            overBudget,
            false,
          );
          if (overBudget()) budgetStopped = true;
        }
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
        scansDeleted +
        dimensionsDeleted +
        recommendationsDeleted +
        recommendationEventsDeleted +
        auditDeleted +
        outcomesDeleted +
        usageEventsDeleted +
        conformanceReportsDeleted +
        conformanceFindingsDeleted +
        memoryCitationsDeleted +
        controlObservationsDeleted +
        // Digests can age out on a tick where nothing else did (an org that turned compaction off
        // still drains its tail), and a destructive act with no trace is what the gate exists to
        // prevent — so it counts as "something happened". `digestsWritten` deliberately does not:
        // a fold only ever happens beside the scan deletes already counted above.
        digestsDeleted;
      if (totalDeleted > 0) {
        const audited = await recordAudit(
          PURGE_ACTION,
          {
            scansDeleted,
            dimensionsDeleted,
            recommendationsDeleted,
            recommendationEventsDeleted,
            auditDeleted,
            outcomesDeleted,
            usageEventsDeleted,
            conformanceReportsDeleted,
            conformanceFindingsDeleted,
            memoryCitationsDeleted,
            controlObservationsDeleted,
            digestsWritten,
            scansCompacted,
            digestsDeleted,
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
        outcomesDeleted,
        usageEventsDeleted,
        conformanceReportsDeleted,
        conformanceFindingsDeleted,
        memoryCitationsDeleted,
        controlObservationsDeleted,
        digestsWritten,
        scansCompacted,
        digestsDeleted,
        digestsWouldWrite,
      });

      if (budgetStopped) {
        // The budget was exhausted inside this org (data-retention #1). Surface it the SAME way the
        // between-orgs stop does — set stoppedEarly, count the resume tail (this org included, since it
        // may still hold stale rows), and push a `(budget):` error so the route's 207 gate trips and cron
        // alerting pages an operator — instead of the platform hard-killing the run with no summary.
        stoppedEarly = true;
        orgsRemaining = configuredRemaining(i); // includes THIS org (still configured, may hold stale rows)
        errors.push(
          `(budget): retention stopped mid-org (${org.slug}) after ${Math.round((now() - startedAt) / 1000)}s with ${orgsRemaining} org(s) unprocessed this tick`,
        );
        break;
      }
    } catch (err) {
      // A prune/sweep threw AFTER some batches already committed (data-retention #3). Each batch is its
      // own durable transaction, so record the PARTIAL counts — gated on a non-zero total, mirroring the
      // success path's `totalDeleted > 0` audit gate — so the summary + its rolled-up totals reflect what
      // was actually deleted this tick instead of discarding it. A throw BEFORE any delete (e.g. during
      // selection) stays out of `results` (no all-zero noise row). The try's own results.push runs only
      // on the success path, so this never double-counts. The self-audit trace is skipped on a throw; the
      // error string is what pages an operator.
      const partialDeleted =
        scansDeleted +
        dimensionsDeleted +
        recommendationsDeleted +
        recommendationEventsDeleted +
        auditDeleted +
        outcomesDeleted +
        usageEventsDeleted +
        conformanceReportsDeleted +
        conformanceFindingsDeleted +
        memoryCitationsDeleted +
        controlObservationsDeleted +
        // Digests can age out on a tick where nothing else did (an org that turned compaction off
        // still drains its tail), and a destructive act with no trace is what the gate exists to
        // prevent — so it counts as "something happened". `digestsWritten` deliberately does not:
        // a fold only ever happens beside the scan deletes already counted above.
        digestsDeleted;
      if (partialDeleted > 0) {
        results.push({
          orgSlug: org.slug,
          policy,
          scansDeleted,
          dimensionsDeleted,
          recommendationsDeleted,
          recommendationEventsDeleted,
          auditDeleted,
          outcomesDeleted,
          usageEventsDeleted,
          conformanceReportsDeleted,
          conformanceFindingsDeleted,
          memoryCitationsDeleted,
          controlObservationsDeleted,
          digestsWritten,
          scansCompacted,
          digestsDeleted,
          digestsWouldWrite,
        });
      }
      errors.push(`${org.slug}: ${err instanceof Error ? err.message : "purge failed"}`);
    }
  }

  // Org-less audit entries (e.g. anonymous public scans) can't carry a per-org policy — sweep
  // them under the global default window so AuditLog can't grow unbounded from that path.
  // Skipped when the run is already over its time budget (it runs on the next scheduled pass).
  if (defaults.auditDays > 0 && overBudget()) {
    stoppedEarly = true;
  } else if (defaults.auditDays > 0) {
    try {
      // Compute the cutoff from the SAME injectable clock as the budget (data-retention #5): now() is
      // opts.now ?? Date.now, so a test/simulation that advances opts.now moves the window and the budget
      // together instead of silently diverging them. Thread overBudget in so a large org-less sweep also
      // yields between batches, and mark stoppedEarly if it stopped short.
      const cutoff = new Date(now() - defaults.auditDays * DAY_MS);
      const auditDeleted = opts.dryRun
        ? await prisma.auditLog.count({ where: { orgId: null, at: { lt: cutoff } } })
        : await pruneAudit(prisma, { orgId: null, at: { lt: cutoff } }, defaults.batchSize, overBudget);
      if (overBudget()) stoppedEarly = true;
      if (auditDeleted > 0) {
        const audited =
          opts.dryRun ||
          (await recordAudit(PURGE_ACTION, { auditDeleted, scope: "orphan" }, { actorId: opts.actorId }));
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
          // The orphan sweep is AuditLog-only by definition: a UsageEvent, a ConformanceReport and an
          // InterventionOutcome all carry a required orgId, so none of them can be org-less. These
          // zeros are a fact about the sweep's scope, not an unmeasured value.
          outcomesDeleted: 0,
          usageEventsDeleted: 0,
          conformanceReportsDeleted: 0,
          conformanceFindingsDeleted: 0,
          memoryCitationsDeleted: 0,
          // A ControlObservation carries a required orgId, so it can no more be org-less than a
          // UsageEvent can: this zero is a fact about the orphan sweep's SCOPE, not an unmeasured value.
          controlObservationsDeleted: 0,
          // A ScanDigest hangs off a Repository, which carries a required org — so, like the three
          // above, these zeros are a fact about the orphan sweep's SCOPE, not an unmeasured value.
          digestsWritten: 0,
          scansCompacted: 0,
          digestsDeleted: 0,
          digestsWouldWrite: null,
        });
      }
    } catch (err) {
      errors.push(`(orphan): ${err instanceof Error ? err.message : "purge failed"}`);
    }
  }

  // MOONSHOT #10 — retire settled queue rows fleet-wide. Runs on every pass (it carries no per-org
  // policy, exactly like the PublicScanQuota sweep below) unless the run is already over budget, in
  // which case the next tick does it. Counted in the summary and traced with its own audit row when
  // it removed anything — a destructive act with no trace is what that gate exists to prevent.
  let scanJobsDeleted = 0;
  if (overBudget()) {
    stoppedEarly = true;
  } else {
    try {
      const cutoff = new Date(now() - SCAN_JOB_RETENTION_DAYS * DAY_MS);
      scanJobsDeleted = opts.dryRun
        ? await prisma.scanJob.count({
            where: { state: { in: [...SCAN_JOB_SETTLED_STATES] }, settledAt: { lt: cutoff } },
          })
        : await pruneSettledScanJobs(prisma, cutoff, defaults.batchSize, overBudget);
      if (overBudget()) stoppedEarly = true;
      if (scanJobsDeleted > 0 && !opts.dryRun) {
        const audited = await recordAudit(
          PURGE_ACTION,
          { scanJobsDeleted, scope: "scan-queue", horizonDays: SCAN_JOB_RETENTION_DAYS },
          { actorId: opts.actorId },
        );
        if (!audited) {
          errors.push(`(scan-queue): retention audit write failed (deletes applied, compliance trace missing)`);
        }
      }
    } catch (err) {
      errors.push(`(scan-queue): ${err instanceof Error ? err.message : "purge failed"}`);
    }
  }

  // Sweep PublicScanQuota rows whose rolling window has fully aged out — they carry no live state
  // (only a re-grantable full allowance), so the IP-keyed table can't be allowed to grow unbounded.
  // Runs on every pass (it's not governed by a per-org retention window) unless the run is already
  // over its time budget, in which case it's deferred to the next pass; best-effort.
  if (overBudget()) {
    stoppedEarly = true;
  } else if (!opts.dryRun) {
    // Skipped in a dry run — the sweep is destructive and carries no per-org policy to preview.
    try {
      await purgeStalePublicScanQuota();
    } catch (err) {
      errors.push(`(public-scan-quota): ${err instanceof Error ? err.message : "purge failed"}`);
    }
  }

  return {
    orgsProcessed: results.length,
    scansDeleted: results.reduce((a, r) => a + r.scansDeleted, 0),
    dimensionsDeleted: results.reduce((a, r) => a + r.dimensionsDeleted, 0),
    recommendationsDeleted: results.reduce((a, r) => a + r.recommendationsDeleted, 0),
    recommendationEventsDeleted: results.reduce((a, r) => a + r.recommendationEventsDeleted, 0),
    auditDeleted: results.reduce((a, r) => a + r.auditDeleted, 0),
    outcomesDeleted: results.reduce((a, r) => a + r.outcomesDeleted, 0),
    usageEventsDeleted: results.reduce((a, r) => a + r.usageEventsDeleted, 0),
    conformanceReportsDeleted: results.reduce((a, r) => a + r.conformanceReportsDeleted, 0),
    conformanceFindingsDeleted: results.reduce((a, r) => a + r.conformanceFindingsDeleted, 0),
    memoryCitationsDeleted: results.reduce((a, r) => a + r.memoryCitationsDeleted, 0),
    controlObservationsDeleted: results.reduce((a, r) => a + r.controlObservationsDeleted, 0),
    // NOT a reduce: the queue sweep is fleet-wide and has no per-org row to sum (see the sweep above).
    scanJobsDeleted,
    digestsWritten: results.reduce((a, r) => a + r.digestsWritten, 0),
    scansCompacted: results.reduce((a, r) => a + r.scansCompacted, 0),
    digestsDeleted: results.reduce((a, r) => a + r.digestsDeleted, 0),
    // One unknown poisons the fleet total: `null` here means "at least one org's window was past the
    // preview cap", which is a different statement from "no digests would be written".
    digestsWouldWrite: results.some((r) => r.digestsWouldWrite === null && r.scansDeleted > 0)
      ? null
      : results.reduce((a, r) => a + (r.digestsWouldWrite ?? 0), 0),
    results,
    errors,
    stoppedEarly,
    orgsRemaining,
    dryRun: opts.dryRun === true,
  };
}

// ---------------------------------------------------------------------------------------------
// On-demand erasure (DSR / right-to-erasure)
//
// Retention above is SCHEDULE-only: an org's data leaves on the cron's timetable, which is not what a
// GDPR Art.17 / SOC2 vendor-review checklist asks for ("erase my data on request, now"). eraseOrgData
// is the owner-triggered counterpart, and it deliberately reuses the SAME primitives the cron uses —
// pruneRepoScans (with a keep-window of 0, i.e. keep nothing) and pruneAudit — so the erasure path can
// never drift from the delete graph the purge path maintains (grandchildren → children → parent, no FK
// cascades under relationMode = "prisma"), and inherits its DSQL batching + conflict retries for free.
//
// BOUNDED, exactly like the cron: every delete is a small batched transaction (never one mega-tx), the
// repo enumeration is cursor-paged, and a wall-clock budget is polled between repos and between delete
// batches. An org too large to drain inside one request stops at a batch boundary and returns
// `complete: false` — every committed batch is durable, so the caller simply calls again to resume.
// This is why the endpoint is idempotent and safe to repeat.
//
// AUDIT ORDERING (deliberate): the erase entry is written AFTER the deletes, never before. An
// org-scoped audit sweep here has NO date cutoff — it removes every AuditLog row for the org — so an
// entry written first would be deleted by the very operation it documents, leaving an erasure with no
// trace. Writing last means the `data.erased` row is the ONLY audit row that survives an
// audit-DELETING erasure: the trail is emptied, and the record of why is what remains. The trade-off
// is that a crash between the deletes and the audit write loses the trace (the deletes still stand);
// the caller surfaces that as `audited: false` rather than reporting a clean success.
//
// AUDIT DISPOSITION — the destructive-override floor on the interactive path (data-retention 07-16 #4).
// The unattended cron has had a safety floor since 07-16 #2 (RETENTION_MIN_*, escapable only via
// RETENTION_FORCE=1); the on-demand path, which is INTERACTIVE, IRREVERSIBLE and reaches the very same
// compliance evidence, had none — one owner-authenticated `includeAudit: true` destroyed the org's
// entire HMAC-signed trail (see db/audit-integrity.ts) wholesale. That asymmetry was backwards: the
// guarded path was the one nobody is watching. The floor is now stated as three explicit dispositions:
//
//   keep    (default)  the trail is untouched; only scan data is erased.
//   redact             IDENTIFIER-ONLY erasure: every row for the org survives as action + timestamp +
//                      tenant, with the actor and the whole meta payload dropped and the row re-signed
//                      (redactAuditIdentity). The subject reference no longer resolves to a person, and
//                      the historical account of what happened and when is still there to export.
//   delete             the old wholesale destruction. REFUSED unless the operator has deliberately set
//                      ERASE_AUDIT_FORCE=1 on the deployment — the same shape as the purge path's
//                      RETENTION_FORCE escape, and the reason the refusal is an env flag rather than
//                      another request field: a caller who can post the request must not also be able
//                      to authorise the exception in the same click.
//
// Why refusal is not prohibition: a genuinely compelled erasure (GDPR Art.17) is the exact scenario the
// flag exists for, so a hard "never" would break the feature. `redact` satisfies that request WITHOUT
// destroying the compliance record, and is what the legacy `includeAudit: true` boolean now resolves to
// — so the existing control keeps working and simply stopped being the more destructive of the two.

/** Env flag that authorises WHOLESALE audit-trail destruction (`auditDisposition: "delete"`). Mirrors
 *  RETENTION_FORCE on the purge path: deliberate, deployment-level, and stated in the refusal message. */
export const ERASE_AUDIT_FORCE_ENV = "ERASE_AUDIT_FORCE";

/** What an erase does to the org's audit trail. See the AUDIT DISPOSITION note above. */
export type AuditDisposition = "keep" | "redact" | "delete";

/**
 * Resolve the requested disposition, translating the legacy `includeAudit` boolean. `includeAudit: true`
 * used to mean "delete the whole trail"; it now means "redact it to identifier-only" — the same
 * user-visible promise (this org's audit trail no longer identifies anyone) minus the irreversible loss
 * of the record itself. A caller that genuinely means deletion must say `auditDisposition: "delete"`.
 * Pure — unit-tested.
 */
export function resolveAuditDisposition(req: Pick<EraseRequest, "includeAudit" | "auditDisposition">): AuditDisposition {
  if (req.auditDisposition) return req.auditDisposition;
  return req.includeAudit === true ? "redact" : "keep";
}

/** True when the deployment has explicitly opted into wholesale audit destruction. */
function auditDeleteForced(): boolean {
  return process.env[ERASE_AUDIT_FORCE_ENV] === "1";
}

/**
 * Rewrite every audit row for an org into identifier-only form (see {@link redactAuditIdentity}).
 * Cursor-paged by id and budget-polled between pages, exactly like the delete loops — the trail of a
 * long-lived org is unbounded, so this must yield the same way a sweep does. Each page is one committed
 * transaction wrapped in the shared conflict retry, so a stop leaves whole pages redacted (never half a
 * row) and the resume call simply continues. Re-running over an already-redacted row is harmless: it is
 * rewritten with a fresh `_redacted` stamp and re-signed. Returns the number of rows redacted.
 */
async function redactOrgAudit(
  prisma: PrismaLike,
  orgId: string,
  batchSize: number,
  redactedAt: string,
  budgetExceeded?: () => boolean,
): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  for (;;) {
    if (budgetExceeded?.()) break;
    const rows = await prisma.auditLog.findMany({
      where: { orgId },
      orderBy: { id: "asc" },
      take: batchSize,
      select: { id: true, action: true, orgId: true, at: true },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    await withRetry(
      () =>
        prisma.$transaction(async (tx) => {
          for (const row of rows) {
            const redacted = redactAuditIdentity(
              { action: row.action, orgId: row.orgId, createdAt: new Date(row.at).toISOString() },
              redactedAt,
            );
            await tx.auditLog.update({
              where: { id: row.id },
              data: { actorId: redacted.actorId, meta: JSON.stringify(redacted.meta) },
            });
          }
        }),
      { label: "erase.redact-audit" },
    );
    total += rows.length;
    if (rows.length < batchSize) break;
    cursor = rows[rows.length - 1]!.id;
  }
  return total;
}

/**
 * Erase the org's improvement-loop history (`LoopRun` + `LoopRunLane`, src/lib/db/loop-runs.ts).
 *
 * A loop run is org-scoped tenant data like any other: it names the repos that were worked, the
 * branch each lane produced, the follow-up ids it dispatched and closed, and the lane's log — which
 * is agent output about the tenant's code. Leaving it behind would make an "erasure" that still
 * reads back the org's recent work, so it goes with the scans.
 *
 * Lanes first, then runs: `relationMode = "prisma"` emits no FK cascades, so children are deleted
 * explicitly before their parent — the same delete-graph convention pruneRepoScans follows. Batched
 * and budget-polled like every other loop here; a stop leaves whole pages deleted and the resume
 * call simply continues (deleted rows leave the predicate, so the real path never needs a cursor).
 * Org scope ONLY: the repo-scoped erase variant does not reach it, since a run is not a repo's row.
 */
async function eraseOrgLoopRuns(
  prisma: PrismaLike,
  orgId: string,
  batchSize: number,
  overBudget: () => boolean,
  dryRun: boolean,
): Promise<{ runs: number; lanes: number }> {
  let runs = 0;
  let lanes = 0;
  let cursor: string | undefined;
  for (;;) {
    if (overBudget()) break;
    const page = await prisma.loopRun.findMany({
      where: { orgId },
      orderBy: { id: "asc" },
      take: batchSize,
      select: { id: true },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    const ids = page.map((r) => r.id);
    if (dryRun) {
      // Preview: count over the SAME predicate the delete uses, and page with a cursor since
      // nothing leaves the table.
      lanes += await prisma.loopRunLane.count({ where: { runId: { in: ids } } });
      runs += ids.length;
      if (page.length < batchSize) break;
      cursor = ids[ids.length - 1]!;
      continue;
    }
    await withRetry(
      () =>
        prisma.$transaction(async (tx) => {
          lanes += (await tx.loopRunLane.deleteMany({ where: { runId: { in: ids } } })).count;
          runs += (await tx.loopRun.deleteMany({ where: { id: { in: ids } } })).count;
        }),
      { label: "erase.loop-runs" },
    );
  }
  return { runs, lanes };
}

/**
 * Erase everything ATHENA holds for the org — her conversations, her open asks, her identity, and
 * the episodes she wrote into the org's memory store (src/lib/db/athena*.ts).
 *
 * She is a resident, org-scoped companion: her threads are the operator's own words, her turns are
 * agent output about the tenant's code, her self-model is a document ABOUT this organization, and her
 * episodes are memories of working with it. Every one of those is tenant data, so an "erasure" that
 * left them behind would leave a mind that still remembers the org that asked to be forgotten.
 *
 * ORDER (relationMode = "prisma" emits no FK cascades, so it is written by hand): proposals → turns →
 * threads → identity → the OrgMemory rows. Children before parents, exactly like eraseOrgLoopRuns.
 *
 * SCOPING CAVEAT, stated here because the counter it produces will be read as broader than it is:
 * this is the FIRST OrgMemory sweep in this module — `retention.ts` covers no memory row today. It is
 * deliberately narrowed to `source: "athena"`, i.e. HER OWN WRITES. Human-authored memories, the
 * scan-pipeline feed, and registry-mirrored notes are untouched and remain a real gap; this function
 * is not a fix for it and must not be widened into one by accident.
 *
 * Org scope ONLY: a thread is not a repo's row, so the repo-scoped erase variant never reaches it.
 */
async function eraseOrgAthena(
  prisma: PrismaLike,
  orgId: string,
  batchSize: number,
  overBudget: () => boolean,
  dryRun: boolean,
): Promise<{ threads: number; turns: number; proposals: number; identity: number; memories: number }> {
  let threads = 0;
  let turns = 0;
  let proposals = 0;
  let identity = 0;
  let memories = 0;

  // ── conversations: proposals + turns, then the threads that own them ───────────────────────────
  let threadCursor: string | undefined;
  for (;;) {
    if (overBudget()) return { threads, turns, proposals, identity, memories };
    const page = await prisma.athenaThread.findMany({
      where: { orgId },
      orderBy: { id: "asc" },
      take: batchSize,
      select: { id: true },
      ...(threadCursor ? { cursor: { id: threadCursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    const ids = page.map((t) => t.id);
    if (dryRun) {
      // Preview: count over the SAME predicates the delete uses, cursor-paged since nothing leaves.
      // Proposals are NOT counted here — the org-wide block below counts them exactly once, and the
      // union of the two real deletes (by threadId, then by orgId) is precisely that same set.
      turns += await prisma.athenaTurn.count({ where: { threadId: { in: ids } } });
      threads += ids.length;
      if (page.length < batchSize) break;
      threadCursor = ids[ids.length - 1]!;
      continue;
    }
    await withRetry(
      () =>
        prisma.$transaction(async (tx) => {
          proposals += (await tx.athenaProposal.deleteMany({ where: { threadId: { in: ids } } })).count;
          turns += (await tx.athenaTurn.deleteMany({ where: { threadId: { in: ids } } })).count;
          threads += (await tx.athenaThread.deleteMany({ where: { id: { in: ids } } })).count;
        }),
      { label: "erase.athena-threads" },
    );
  }

  // A proposal is org-scoped as well as thread-scoped, so a row whose thread vanished in an earlier
  // (budget-stopped) call would otherwise survive forever. Sweep the org predicate too — and in a
  // preview this ONE count is the whole proposal figure, over the same set the two deletes union to.
  if (!overBudget()) {
    if (dryRun) proposals += await prisma.athenaProposal.count({ where: { orgId } });
    else {
      proposals += (
        await withRetry(() => prisma.athenaProposal.deleteMany({ where: { orgId } }), {
          label: "erase.athena-proposals",
        })
      ).count;
    }
  }

  // ── identity: at most two rows (constitution + self_model), so no paging is warranted ──────────
  if (!overBudget()) {
    if (dryRun) identity += await prisma.athenaIdentity.count({ where: { orgId } });
    else {
      identity += (
        await withRetry(() => prisma.athenaIdentity.deleteMany({ where: { orgId } }), {
          label: "erase.athena-identity",
        })
      ).count;
    }
  }

  // ── episodes: OrgMemory rows SHE wrote (see the scoping caveat above) ──────────────────────────
  const memoryWhere = { orgId, source: ATHENA_MEMORY_SOURCE };
  if (dryRun) {
    if (!overBudget()) memories += await prisma.orgMemory.count({ where: memoryWhere });
  } else {
    for (;;) {
      if (overBudget()) break;
      const page = await prisma.orgMemory.findMany({
        where: memoryWhere,
        orderBy: { id: "asc" },
        take: batchSize,
        select: { id: true },
      });
      if (page.length === 0) break;
      const ids = page.map((m) => m.id);
      memories += (
        await withRetry(() => prisma.orgMemory.deleteMany({ where: { id: { in: ids } } }), {
          label: "erase.athena-memories",
        })
      ).count;
    }
  }

  return { threads, turns, proposals, identity, memories };
}

/**
 * Erase the ORG-SCOPED wave-1 ledgers: the outcome ledger (#9), the LLM meter (#11), the repo-memory
 * mirror (#14), the doctor control ledger (#16), the registry knowledge/conformance/signals tables
 * (#18), the skill usage samples (#19) and the lessons / trace / memory-proposal lane (#36) — plus
 * the wave-2 ones: the lane verdict ledger and memory-candidate queue (#25) and the practice
 * adoption / house-pattern ledger (#33). (OrgMemoryCitation is NOT here: it must die before the
 * OrgMemory rows it points at, so it is swept earlier — see eraseOrgMemoryCitations.)
 *
 * WHY EACH ONE IS TENANT DATA, since an erase that leaves any of them behind is not an erasure:
 * an InterventionOutcome names the repo and the measured lift; a UsageEvent names the repo, the team
 * and the model spend; a RepoMemoryMirror IS the tenant's own repo-authored prose; a
 * ConformanceReport is the tenant's control posture per repo; the #18 tables carry the tenant's
 * context names, deviation evidence and the file:line citations behind them; a RegistrySignal names
 * the contributor; and an OrgSkillLesson body is text a tenant's engineer wrote.
 *
 * NOT declarative. `RepoMemoryMirror.org` declares `onDelete: Cascade`, but relationMode = "prisma"
 * emits no FK — the cascade is Prisma CLIENT-side emulation, it only runs for deletes the client
 * resolves through the relation, and nothing here ever deletes the Organization row (an erase
 * deliberately leaves the tenant existing). So the sweep is written by hand, exactly like every other
 * cascade in this module. Same for ConformanceFinding → ConformanceReport: children first, in one
 * transaction, then the parent.
 *
 * Bounded and resumable like every other loop here: each table is drained in batched, retried
 * transactions with the budget polled between batches, so a stop leaves whole batches deleted and
 * the resume call simply continues (deleted rows leave the predicate, so no cursor is needed).
 *
 * Org scope ONLY. The per-repo half of the mirror is handled beside the scan graph in `eraseRepo`,
 * because a repo removed from the org must take its mirrored memory with it without the whole tenant
 * being erased.
 */
async function eraseOrgLedgers(
  prisma: PrismaLike,
  orgId: string,
  batchSize: number,
  overBudget: () => boolean,
  dryRun: boolean,
): Promise<{
  outcomes: number;
  usageEvents: number;
  memoryMirrors: number;
  conformanceReports: number;
  conformanceFindings: number;
  skillLessons: number;
  skillTraces: number;
  memoryProposals: number;
  registryLedger: number;
  laneOutcomes: number;
  memoryCandidates: number;
  practiceAdoptions: number;
  housePatterns: number;
  scanJobs: number;
  controlObservations: number;
  controlSeals: number;
  repoAdmissions: number;
  installations: number;
}> {
  const totals = {
    outcomes: 0,
    usageEvents: 0,
    memoryMirrors: 0,
    conformanceReports: 0,
    conformanceFindings: 0,
    skillLessons: 0,
    skillTraces: 0,
    memoryProposals: 0,
    registryLedger: 0,
    laneOutcomes: 0,
    memoryCandidates: 0,
    practiceAdoptions: 0,
    housePatterns: 0,
    scanJobs: 0,
    controlObservations: 0,
    controlSeals: 0,
    repoAdmissions: 0,
    installations: 0,
  };

  /** Drain one flat org-scoped table. Counts in a preview; batched deletes otherwise. */
  const drain = async (
    find: (take: number) => Promise<{ id: string }[]>,
    count: () => Promise<number>,
    del: (ids: string[]) => Promise<number>,
    label: string,
  ): Promise<number> => {
    if (overBudget()) return 0;
    if (dryRun) return count();
    return pruneAgedLedger(find, (ids) => withRetry(() => del(ids), { label }), batchSize, overBudget);
  };

  const where = { orgId };
  const page = (take: number) => ({ where, orderBy: { id: "asc" } as const, take, select: { id: true } });

  totals.outcomes = await drain(
    (take) => prisma.interventionOutcome.findMany(page(take)),
    () => prisma.interventionOutcome.count({ where }),
    async (ids) => (await prisma.interventionOutcome.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.outcomes",
  );

  totals.usageEvents = await drain(
    (take) => prisma.usageEvent.findMany(page(take)),
    () => prisma.usageEvent.count({ where }),
    async (ids) => (await prisma.usageEvent.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.usage-events",
  );

  totals.memoryMirrors = await drain(
    (take) => prisma.repoMemoryMirror.findMany(page(take)),
    () => prisma.repoMemoryMirror.count({ where }),
    async (ids) => (await prisma.repoMemoryMirror.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.repo-memory-mirror",
  );

  // Findings before their report, in one transaction — see the header note on the emulated cascade.
  totals.conformanceReports = await drain(
    (take) => prisma.conformanceReport.findMany(page(take)),
    () => prisma.conformanceReport.count({ where }),
    async (ids) =>
      prisma.$transaction(async (tx) => {
        totals.conformanceFindings += (await tx.conformanceFinding.deleteMany({ where: { reportId: { in: ids } } }))
          .count;
        return (await tx.conformanceReport.deleteMany({ where: { id: { in: ids } } })).count;
      }),
    "erase.conformance",
  );
  if (dryRun && !overBudget()) {
    // Preview: the findings count is the one number the delete's inner deleteMany would remove.
    totals.conformanceFindings = await prisma.conformanceFinding.count({
      where: { report: { orgId } },
    });
  }

  totals.skillLessons = await drain(
    (take) => prisma.orgSkillLesson.findMany(page(take)),
    () => prisma.orgSkillLesson.count({ where }),
    async (ids) => (await prisma.orgSkillLesson.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.skill-lessons",
  );

  totals.skillTraces = await drain(
    (take) => prisma.orgSkillTrace.findMany(page(take)),
    () => prisma.orgSkillTrace.count({ where }),
    async (ids) => (await prisma.orgSkillTrace.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.skill-traces",
  );

  totals.memoryProposals = await drain(
    (take) => prisma.orgMemoryProposal.findMany(page(take)),
    () => prisma.orgMemoryProposal.count({ where }),
    async (ids) => (await prisma.orgMemoryProposal.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.memory-proposals",
  );

  // The registry ledger, reported as ONE figure: six tables that only ever exist together (they are
  // written by a single index pass and read as one view), so six separate counters on the erase
  // receipt would be six numbers no reader can act on differently.
  totals.registryLedger += await drain(
    (take) => prisma.orgKnowledgeSubject.findMany(page(take)),
    () => prisma.orgKnowledgeSubject.count({ where }),
    async (ids) => (await prisma.orgKnowledgeSubject.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.knowledge-subjects",
  );
  totals.registryLedger += await drain(
    (take) => prisma.repoConformance.findMany(page(take)),
    () => prisma.repoConformance.count({ where }),
    async (ids) => (await prisma.repoConformance.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.repo-conformance",
  );
  totals.registryLedger += await drain(
    (take) => prisma.repoConformanceMap.findMany(page(take)),
    () => prisma.repoConformanceMap.count({ where }),
    async (ids) => (await prisma.repoConformanceMap.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.repo-conformance-map",
  );
  totals.registryLedger += await drain(
    (take) => prisma.registrySignal.findMany(page(take)),
    () => prisma.registrySignal.count({ where }),
    async (ids) => (await prisma.registrySignal.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.registry-signals",
  );
  totals.registryLedger += await drain(
    (take) => prisma.registrySignalContribution.findMany(page(take)),
    () => prisma.registrySignalContribution.count({ where }),
    async (ids) => (await prisma.registrySignalContribution.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.registry-contributions",
  );
  totals.registryLedger += await drain(
    (take) => prisma.orgSkillUsageSample.findMany(page(take)),
    () => prisma.orgSkillUsageSample.count({ where }),
    async (ids) => (await prisma.orgSkillUsageSample.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.skill-usage-samples",
  );
  // Knowledge base rebuild — the dispatch ledger rides in the same figure: a RegistryDispatch
  // names the repo, the branch, the PR and the subjects a brief cited, and a local run's receipt.
  totals.registryLedger += await drain(
    (take) => prisma.registryDispatch.findMany(page(take)),
    () => prisma.registryDispatch.count({ where }),
    async (ids) => (await prisma.registryDispatch.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.registry-dispatches",
  );

  // ── MOONSHOT WAVE 2 ───────────────────────────────────────────────────────────────────────────
  // #25 — the lane verdict ledger. Tenant data twice over: a LaneItemOutcome names the repo, the
  // recommendation and the FILES an agent touched, and its `reason` is the agent's prose about this
  // organization's code. Standalone (denormalized orgId, no FK), so nothing removes it but this.
  totals.laneOutcomes = await drain(
    (take) => prisma.laneItemOutcome.findMany(page(take)),
    () => prisma.laneItemOutcome.count({ where }),
    async (ids) => (await prisma.laneItemOutcome.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.lane-outcomes",
  );

  // #25 — the memory-candidate queue. A candidate is a proposed org memory that no human has ruled
  // on yet; leaving the pending ones behind would let an erased tenant's lessons be promoted into
  // OrgMemory afterwards, which is the erasure failing in the most visible way possible.
  totals.memoryCandidates = await drain(
    (take) => prisma.orgMemoryCandidate.findMany(page(take)),
    () => prisma.orgMemoryCandidate.count({ where }),
    async (ids) => (await prisma.orgMemoryCandidate.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.memory-candidates",
  );

  // #33 — the adoption ledger. Each row names a repo, a file path inside it and the content hashes
  // of what that file held; the ledger is a durable record of the tenant's repositories.
  totals.practiceAdoptions = await drain(
    (take) => prisma.practiceAdoption.findMany(page(take)),
    () => prisma.practiceAdoption.count({ where }),
    async (ids) => (await prisma.practiceAdoption.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.practice-adoption",
  );

  // #33 — the mined house patterns. `linesJson` IS the tenant's own prose (mined out of its repos)
  // and `exemplarsJson` names the repos that agreed, so this is tenant content, not a catalog.
  totals.housePatterns = await drain(
    (take) => prisma.housePatternVersion.findMany(page(take)),
    () => prisma.housePatternVersion.count({ where }),
    async (ids) => (await prisma.housePatternVersion.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.house-patterns",
  );

  // ── MOONSHOT WAVE 3 ───────────────────────────────────────────────────────────────────────────
  // #10 — the scan queue. Erased in FULL, unlike the 30-day retention sweep above, which only ever
  // retires SETTLED rows: an erasure that left the queued and claimed jobs behind would keep naming
  // the tenant's repositories, and the worker would then go and re-scan them.
  totals.scanJobs = await drain(
    (take) => prisma.scanJob.findMany(page(take)),
    () => prisma.scanJob.count({ where }),
    async (ids) => (await prisma.scanJob.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.scan-jobs",
  );

  // #1 — the control ledger, with none of the purge path's keep-newest exception. That rule exists so
  // RETENTION never destroys an org's current posture; an ERASURE is being asked to destroy exactly
  // that, and a "most recent state of every control on every repo you own" row surviving a DSR
  // request would be the erasure failing at its whole purpose.
  totals.controlObservations = await drain(
    (take) => prisma.controlObservation.findMany(page(take)),
    () => prisma.controlObservation.count({ where }),
    async (ids) => (await prisma.controlObservation.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.control-observations",
  );

  // #1 — the daily seals, deleted AFTER the observations they sealed (the module's children-then-parent
  // convention). This is the ONLY path that removes a seal: the purge deliberately keeps a sealed day's
  // seal after its rows age out, so a shortened window stays detectable. An erasure is the one case
  // where that argument inverts — a surviving seal carries the tenant's org id and a row count for
  // every day it operated, which is exactly the metadata a right-to-erasure request is about.
  totals.controlSeals = await drain(
    (take) => prisma.controlLedgerSeal.findMany(page(take)),
    () => prisma.controlLedgerSeal.count({ where }),
    async (ids) => (await prisma.controlLedgerSeal.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.control-seals",
  );

  // ── MOONSHOT WAVE 4 ───────────────────────────────────────────────────────────────────────────
  // #8 — the admission decisions. Keyed by (orgId, repoFullName) with no FK, exactly like the
  // adoption ledger above, so nothing deletes them implicitly. Each surviving row would keep naming
  // one of the tenant's repositories AND recording a governance judgement about it ("blocked",
  // "agents-allowed", who decided, and the rationale they typed) — tenant prose about a repository
  // that is no longer here. The per-repo half of this sweep is in `eraseRepo`.
  totals.repoAdmissions = await drain(
    (take) => prisma.repoAdmission.findMany(page(take)),
    () => prisma.repoAdmission.count({ where }),
    async (ids) => (await prisma.repoAdmission.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.repo-admissions",
  );

  // #4 — the forge installations. This is the one ledger on this path holding a live CREDENTIAL:
  // `credentialRef` is encryptSecret() ciphertext, and deleting the row is what destroys it. There
  // is no separate secret store to sweep afterwards and no revocation call to make — the ciphertext
  // IS the secret at rest, so an erase that skipped this table would leave the tenant's forge token
  // recoverable-with-the-key after the tenant was erased. Org-scoped and batched like the rest.
  totals.installations = await drain(
    (take) => prisma.installation.findMany(page(take)),
    () => prisma.installation.count({ where }),
    async (ids) => (await prisma.installation.deleteMany({ where: { id: { in: ids } } })).count,
    "erase.installations",
  );

  return totals;
}

/**
 * MOONSHOT #17 — erase the org's memory citations, and do it BEFORE anything deletes an OrgMemory
 * row (spec 17 §Handoffs 5). Order is the whole reason this is its own function rather than another
 * block inside {@link eraseOrgLedgers}: the ledgers sweep runs after `eraseOrgAthena`, which deletes
 * the OrgMemory rows Athena wrote — so a citation sweep placed there would, on a budget-stopped run,
 * leave rows pointing at memories that no longer exist. A citation carries the tenant's session ids,
 * actor names and the agent's note, so it is tenant data in its own right and never merely a
 * dependent count.
 *
 * `memoryId` has no FK (relationMode = "prisma"), so nothing deletes these implicitly. Org-scoped
 * and batched like every other loop here; a preview counts over the SAME predicate the delete uses.
 */
async function eraseOrgMemoryCitations(
  prisma: PrismaLike,
  orgId: string,
  batchSize: number,
  overBudget: () => boolean,
  dryRun: boolean,
): Promise<number> {
  if (overBudget()) return 0;
  if (dryRun) return prisma.orgMemoryCitation.count({ where: { orgId } });
  return pruneAgedLedger(
    (take) => prisma.orgMemoryCitation.findMany({ where: { orgId }, orderBy: { id: "asc" }, take, select: { id: true } }),
    async (ids) =>
      (
        await withRetry(() => prisma.orgMemoryCitation.deleteMany({ where: { id: { in: ids } } }), {
          label: "erase.memory-citations",
        })
      ).count,
    batchSize,
    overBudget,
  );
}

/** The function cap the erase route DECLARES (`export const maxDuration`). Next.js needs that segment
 *  config to be a literal, so the route can't import this — a route test pins the two together instead
 *  (same contract as {@link PURGE_MAX_DURATION_S}). */
export const ERASE_MAX_DURATION_S = 60;
/** Headroom before the declared cap so a large erase stops at a batch boundary and can still answer. */
export const ERASE_BUDGET_HEADROOM_MS = 10_000;
/** Default wall-clock budget for one erase call, DERIVED from the route's declared cap. */
export const ERASE_DEFAULT_TIME_BUDGET_MS = ERASE_MAX_DURATION_S * 1000 - ERASE_BUDGET_HEADROOM_MS;

/** What one erase call should remove. */
export interface EraseRequest {
  /** Org slug (the tenant being erased). */
  orgSlug: string;
  /** Repo-scoped variant: erase only this `owner/name`'s scans. Audit is never repo-scoped, so an
   *  audit sweep is not available (and not attempted) for this variant. */
  repoFullName?: string;
  /** LEGACY alias for `auditDisposition: "redact"` (org scope only). Off by default. It used to mean
   *  wholesale deletion; see the AUDIT DISPOSITION note above for why it no longer can. */
  includeAudit?: boolean;
  /** Org-scope only: what to do with the org's audit trail. Defaults to the `includeAudit` translation
   *  ("keep" unless that legacy flag is set). `"delete"` is refused without ERASE_AUDIT_FORCE=1. */
  auditDisposition?: AuditDisposition;
  /** Preview mode: count what this request WOULD erase, deleting nothing, redacting nothing and writing
   *  no audit entry (data-retention 07-16 #20). The counts come from the same predicate the delete uses
   *  (see pruneRepoScans). Like the purge dry run, the audit-disposition floor is not enforced here —
   *  previewing the blast radius of a `delete` is exactly what an operator needs before asking for one. */
  dryRun?: boolean;
  actorId?: string;
  /** Rows deleted per batch; clamped through {@link clampBatchSize}. */
  batchSize?: number;
  /** Wall-clock budget (ms); `0` = unlimited, matching the module's 0-sentinel. */
  timeBudgetMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

/** What an erase call actually removed. */
export interface EraseResult {
  orgSlug: string;
  scope: "org" | "repo";
  repoFullName?: string;
  /** Repos whose scan graph was walked this call (1 for the repo-scoped variant). */
  reposProcessed: number;
  scansDeleted: number;
  dimensionsDeleted: number;
  recommendationsDeleted: number;
  recommendationEventsDeleted: number;
  /** Loop runs removed (org scope only — a LoopRun belongs to the org, not to a repo). */
  loopRunsDeleted: number;
  /** Loop-run lanes removed. Deleted BEFORE their runs: relationMode = "prisma" emits no cascade. */
  loopLanesDeleted: number;
  /** Athena conversations removed (org scope only — a thread belongs to the org, not to a repo). */
  athenaThreadsDeleted: number;
  /** Turns removed. Deleted BEFORE their threads — no cascade exists to do it for us. */
  athenaTurnsDeleted: number;
  /** Proposals removed (her open asks, and the answered ones with their outcomes). */
  athenaProposalsDeleted: number;
  /** Identity rows removed: the constitution and the self-model, at most one of each. */
  athenaIdentityDeleted: number;
  /** OrgMemory rows removed — HER episodes only (`source: "athena"`). This is the module's first
   *  memory sweep and is deliberately narrow: human, scan-pipeline and registry memories are NOT
   *  covered by any erase path yet. See eraseOrgAthena's scoping caveat before reading this as
   *  "memory is now erased". */
  athenaMemoriesDeleted: number;
  /** InterventionOutcome rows removed (moonshot #9) — org scope removes them all; a repo-scoped
   *  erase removes the ones whose scan bookends died with the repo's scan graph. */
  outcomesDeleted: number;
  /** UsageEvent rows removed — the org's whole metered-inference ledger (moonshot #11). */
  usageEventsDeleted: number;
  /** RepoMemoryMirror rows removed (moonshot #14). Repo-scoped erases remove only that repo's. */
  memoryMirrorsDeleted: number;
  /** ConformanceReport rows removed (moonshot #16), org scope only. */
  conformanceReportsDeleted: number;
  /** ConformanceFinding rows removed with them — by hand, before their parent (the schema's
   *  onDelete: Cascade is client-side emulation a bulk deleteMany never runs). */
  conformanceFindingsDeleted: number;
  /** OrgSkillLesson rows removed (moonshot #36), org scope only. */
  skillLessonsDeleted: number;
  /** OrgSkillTrace rows removed (moonshot #36), org scope only. */
  skillTracesDeleted: number;
  /** OrgMemoryProposal rows removed (moonshot #36), org scope only. */
  memoryProposalsDeleted: number;
  /** The registry ledger as ONE figure (moonshot #18/#19): OrgKnowledgeSubject + RepoConformance +
   *  RepoConformanceMap + RegistrySignal + RegistrySignalContribution + OrgSkillUsageSample, plus
   *  RegistryDispatch (knowledge base rebuild). They are written by a single index pass (and the
   *  sweep / dispatches it chains) and read as one view, so they are reported as one number. */
  registryLedgerDeleted: number;
  /** LaneItemOutcome rows removed (moonshot #25), org scope only. */
  laneOutcomesDeleted: number;
  /** OrgMemoryCandidate rows removed (moonshot #25), org scope only — including the PENDING ones,
   *  which would otherwise still be promotable into OrgMemory after the tenant was erased. */
  memoryCandidatesDeleted: number;
  /** OrgMemoryCitation rows removed (moonshot #17), org scope only. Swept BEFORE any OrgMemory
   *  delete on this path, so a budget-stopped run never leaves a citation pointing at nothing. */
  memoryCitationsDeleted: number;
  /** PracticeAdoption rows removed (moonshot #33). A repo-scoped erase removes only that repo's. */
  practiceAdoptionsDeleted: number;
  /** HousePatternVersion rows removed (moonshot #33), org scope only: a pattern is mined ACROSS
   *  repos, so one repo leaving the org does not un-mine it. */
  housePatternsDeleted: number;
  /** `ScanJob` rows removed (moonshot #10), org scope only — the whole queue, not just the settled
   *  rows the 30-day retention sweep retires: a queued job still names the tenant's repositories, and
   *  a worker would act on it after the erasure. */
  scanJobsDeleted: number;
  /** `ControlObservation` rows removed (moonshot #1), org scope only. ALL of them, including each
   *  pair's newest — the purge path's keep-newest rule protects the org's current posture, and an
   *  erasure is precisely the request to destroy it. */
  controlObservationsDeleted: number;
  /** `ControlLedgerSeal` rows removed (moonshot #1), org scope only. The one path that deletes a
   *  seal: retention keeps a day's seal after its rows age out so the gap stays detectable, but a
   *  seal still carries the tenant's org id and a row count per day it operated. */
  controlSealsDeleted: number;
  /** `RepoAdmission` rows removed (moonshot #8). A repo-scoped erase removes only that repo's: the
   *  row asserts a governance verdict ABOUT one repository, so it goes when the repository does. */
  repoAdmissionsDeleted: number;
  /** `Installation` rows removed (moonshot #4), org scope only. The only ledger on this path that
   *  carries a credential: `credentialRef` is ciphertext, so deleting the row IS destroying the
   *  secret — there is no separate store to sweep afterwards. */
  installationsDeleted: number;
  /** `ScanDigest` rows removed (moonshot #32). An erase both REFUSES to compact and deletes the
   *  compacted tail: a summary of erased data is still that data's shadow. */
  digestsDeleted: number;
  /** Audit rows DESTROYED (only ever non-zero for `auditDisposition: "delete"`). */
  auditDeleted: number;
  /** Audit rows reduced to identifier-only form — the historical account that SURVIVED the erasure. */
  auditRedacted: number;
  /** What this call did (or, in a preview, would do) to the audit trail. */
  auditDisposition: AuditDisposition;
  /** True when the wall-clock budget stopped this call at a batch boundary — call again to resume. */
  stoppedEarly: boolean;
  /** True when everything in scope was erased in this call (`!stoppedEarly`). */
  complete: boolean;
  /** False when the `data.erased` trace could not be written (deletes still stand — see the ordering
   *  note above). Callers must surface this rather than reporting a clean success. */
  audited: boolean;
  /** True when this was a PREVIEW: nothing was deleted, redacted or audited, and the counts are
   *  would-erase totals. A preview must never be mistaken for a performed erasure. */
  dryRun: boolean;
}

/** Erase outcome: a refusal the caller maps to an HTTP status, or the result of a performed erase.
 *  `audit-delete-refused` is the destructive-override floor: the request asked to DESTROY the trail
 *  without ERASE_AUDIT_FORCE=1, so nothing at all was erased (the refusal is checked before any
 *  delete — a half-done erase that wiped the scans and then declined the audit part would be worse
 *  than either outcome). */
export type EraseOutcome =
  | { ok: false; reason: "no-db" | "unknown-org" | "unknown-repo" | "audit-delete-refused" }
  | ({ ok: true } & EraseResult);

/** Scan-DERIVED caches denormalized onto Repository. Erasing the scans without clearing these would
 *  leave the analysis (tech stack, passport, head pins, last-attempt status) readable on the dashboard
 *  after an "erasure" — so they are reset as part of the same operation. Owner-AUTHORED config
 *  (watch flag, schedule, segment tags, passport overrides) is configuration, not scan output, and is
 *  left alone: erasure removes the data, it does not silently unconfigure the tenant. */
const ERASED_REPO_CACHE_RESET = {
  techStackJson: null,
  passportJson: null,
  headSha: null,
  headEtag: null,
  lastScanAt: null,
  lastScanStatus: null,
  lastScanError: null,
  lastScanAttemptAt: null,
} as const;

/**
 * Owner-triggered, on-demand erasure of a tenant's scan data (and optionally its audit trail).
 *
 * Reuses the cron's pruneRepoScans/pruneAudit primitives with a keep-window of 0 and no date cutoff.
 * Bounded and resumable (see the section header); writes a `data.erased` audit entry LAST so the trace
 * survives an audit-including erasure. Never deletes the Organization / Repository / Membership rows
 * themselves — the tenant keeps existing, it just has no analysis history left.
 */
export async function eraseOrgData(req: EraseRequest): Promise<EraseOutcome> {
  if (!isDbConfigured()) return { ok: false, reason: "no-db" };
  const prisma = getPrisma();
  const dryRun = req.dryRun === true;
  // Audit disposition is an ORG-SCOPE concept: a repo-scoped erase never reaches the trail (the trail
  // has no repo dimension), so it is pinned to "keep" and cannot be refused by the floor below.
  const auditDisposition = req.repoFullName?.trim() ? "keep" : resolveAuditDisposition(req);
  // Destructive-override floor, checked BEFORE anything is touched (see the AUDIT DISPOSITION note).
  // A preview is exempt for the same reason the purge dry run is: seeing what a `delete` would cost is
  // the input to the decision, not the decision.
  if (!dryRun && auditDisposition === "delete" && !auditDeleteForced()) {
    return { ok: false, reason: "audit-delete-refused" };
  }
  const now = req.now ?? Date.now;
  const startedAt = now();
  const batchSize = clampBatchSize(req.batchSize ?? null);
  const timeBudgetMs = req.timeBudgetMs ?? ERASE_DEFAULT_TIME_BUDGET_MS;
  const overBudget = () => timeBudgetMs > 0 && now() - startedAt >= timeBudgetMs;

  const slug = req.orgSlug.trim().toLowerCase();
  const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
  if (!org) return { ok: false, reason: "unknown-org" };

  const repoFullName = req.repoFullName?.trim();
  const scope: "org" | "repo" = repoFullName ? "repo" : "org";

  let reposProcessed = 0;
  let scansDeleted = 0;
  let dimensionsDeleted = 0;
  let recommendationsDeleted = 0;
  let recommendationEventsDeleted = 0;
  let auditDeleted = 0;
  let auditRedacted = 0;
  let loopRunsDeleted = 0;
  let loopLanesDeleted = 0;
  let athenaThreadsDeleted = 0;
  let athenaTurnsDeleted = 0;
  let athenaProposalsDeleted = 0;
  let athenaIdentityDeleted = 0;
  let athenaMemoriesDeleted = 0;
  let outcomesDeleted = 0;
  let usageEventsDeleted = 0;
  let memoryMirrorsDeleted = 0;
  let conformanceReportsDeleted = 0;
  let conformanceFindingsDeleted = 0;
  let skillLessonsDeleted = 0;
  let skillTracesDeleted = 0;
  let memoryProposalsDeleted = 0;
  let registryLedgerDeleted = 0;
  let laneOutcomesDeleted = 0;
  let memoryCandidatesDeleted = 0;
  let memoryCitationsDeleted = 0;
  let practiceAdoptionsDeleted = 0;
  let housePatternsDeleted = 0;
  let scanJobsDeleted = 0;
  let controlObservationsDeleted = 0;
  let controlSealsDeleted = 0;
  let repoAdmissionsDeleted = 0;
  let installationsDeleted = 0;
  let digestsDeleted = 0;
  let stoppedEarly = false;

  // Erase ONE repo's scan graph + reset its scan-derived caches. Each batch inside pruneRepoScans is
  // its own committed transaction (bounded); the cache reset follows the deletes so a mid-erase stop
  // never leaves "no scans but a stale passport" — worst case the caches are reset on the resume call.
  // In a preview, the SAME call counts instead of deleting (countOnly) and the cache reset is skipped.
  const eraseRepo = async (repoId: string, repoName?: string) => {
    // MOONSHOT #32 — `compact: false`, ALWAYS, and not merely because the org's policy might say so:
    // a right-to-erasure request must not mint a durable summary of the very data it is erasing. An
    // erase that left behind "here is the monthly average of what we deleted" would be an erasure in
    // name only, so the existing digests are deleted below instead.
    const r = await pruneRepoScans(prisma, repoId, 0, batchSize, overBudget, dryRun, false);
    scansDeleted += r.scans;
    dimensionsDeleted += r.dimensions;
    recommendationsDeleted += r.recommendations;
    recommendationEventsDeleted += r.events;
    outcomesDeleted += r.outcomes;
    reposProcessed++;
    // The repo's compacted tail. Batched and budget-polled like every other loop here; in a preview
    // it is counted over the SAME `{ repoId }` predicate the delete uses.
    if (dryRun) {
      digestsDeleted += await prisma.scanDigest.count({ where: { repoId } });
    } else {
      for (;;) {
        if (overBudget()) break;
        const page = await prisma.scanDigest.findMany({
          where: { repoId },
          orderBy: { id: "asc" },
          take: batchSize,
          select: { id: true },
        });
        if (page.length === 0) break;
        const ids = page.map((d) => d.id);
        digestsDeleted += (
          await withRetry(() => prisma.scanDigest.deleteMany({ where: { id: { in: ids } } }), {
            label: "erase.scan-digests",
          })
        ).count;
      }
    }
    // MOONSHOT #14 — the repo's mirrored `.ai/memory/` entries, keyed by (orgId, repoFullName) and
    // NOT by repoId. The org-wide sweep below reaches them for a full erase, but a REPO-scoped erase
    // (and, later, a repo removed from the org) would otherwise leave the tenant's own repo-authored
    // prose readable in the Memory tab after the repo it came from is gone — an "erasure" that still
    // reads back what the repo said. The declared `onDelete: Cascade` does not help here: it hangs off
    // the Organization relation, and this path deletes no Organization row.
    if (repoName) {
      if (dryRun) {
        memoryMirrorsDeleted += await prisma.repoMemoryMirror.count({
          where: { orgId: org.id, repoFullName: repoName },
        });
      } else {
        memoryMirrorsDeleted += (
          await withRetry(
            () => prisma.repoMemoryMirror.deleteMany({ where: { orgId: org.id, repoFullName: repoName } }),
            { label: "erase.repo-memory-mirror-by-repo" },
          )
        ).count;
      }
      // MOONSHOT #33 — the repo's adoption ledger, keyed by (orgId, repoFullName) for the same
      // reason and with the same hazard: a REPO-scoped erase that left these behind would keep a
      // durable record of which files that repo held and what was in them, addressed by path, after
      // the repo itself is gone. The org-wide sweep below reaches them on a full erase; this is the
      // per-repo half. HousePatternVersion is deliberately NOT swept here — it is org-level, mined
      // across repos, and one repo leaving does not un-mine the org's pattern.
      if (dryRun) {
        practiceAdoptionsDeleted += await prisma.practiceAdoption.count({
          where: { orgId: org.id, repoFullName: repoName },
        });
      } else {
        practiceAdoptionsDeleted += (
          await withRetry(
            () => prisma.practiceAdoption.deleteMany({ where: { orgId: org.id, repoFullName: repoName } }),
            { label: "erase.practice-adoption-by-repo" },
          )
        ).count;
      }
      // MOONSHOT #8 — the repo's admission decision, keyed by (orgId, repoFullName) for the third
      // time on this path and with a hazard of its own: an admission row left behind after the repo
      // is gone still asserts a governance verdict about it — "agents-allowed", who granted it, and
      // the rationale a person wrote — and the compiler would hand that stale grant straight back to
      // the next import of the same coordinate. `rulesetId` makes that worse rather than better: it
      // names a ruleset on a forge this deployment may no longer be able to reach, so the row reads
      // as a perimeter that is enforced while nothing here can check. The org-wide sweep reaches
      // these on a full erase; this is the per-repo half.
      if (dryRun) {
        repoAdmissionsDeleted += await prisma.repoAdmission.count({
          where: { orgId: org.id, repoFullName: repoName },
        });
      } else {
        repoAdmissionsDeleted += (
          await withRetry(
            () => prisma.repoAdmission.deleteMany({ where: { orgId: org.id, repoFullName: repoName } }),
            { label: "erase.repo-admission-by-repo" },
          )
        ).count;
      }
    }
    if (dryRun) return;
    await withRetry(() => prisma.repository.update({ where: { id: repoId }, data: { ...ERASED_REPO_CACHE_RESET } }), {
      label: "erase.reset-repo-cache",
    });
  };

  if (repoFullName) {
    const repo = await prisma.repository.findUnique({
      where: { orgId_fullName: { orgId: org.id, fullName: repoFullName } },
      select: { id: true },
    });
    if (!repo) return { ok: false, reason: "unknown-repo" };
    await eraseRepo(repo.id, repoFullName);
    if (overBudget()) stoppedEarly = true;
  } else {
    // Cursor-paged repo enumeration (never one unbounded read), budget polled between repos.
    let repoCursor: string | undefined;
    repoPages: for (;;) {
      const repos = await prisma.repository.findMany({
        where: { orgId: org.id },
        orderBy: { id: "asc" },
        select: { id: true },
        take: REPO_PAGE_SIZE,
        ...(repoCursor ? { cursor: { id: repoCursor }, skip: 1 } : {}),
      });
      if (repos.length === 0) break;
      for (const repo of repos) {
        if (overBudget()) {
          stoppedEarly = true;
          break repoPages;
        }
        // No repo name passed on the ORG path on purpose: eraseOrgLedgers below sweeps the whole
        // org's mirror in one predicate. Doing both would make a PREVIEW count the same rows twice
        // (the real deletes wouldn't double-count, which is exactly what makes that bug quiet).
        await eraseRepo(repo.id);
      }
      if (repos.length < REPO_PAGE_SIZE) break;
      repoCursor = repos[repos.length - 1]!.id;
    }

    // Improvement-loop history: org-scoped, always erased (it is tenant data, not compliance
    // evidence, so there is no disposition to choose). Skipped once the budget is spent, exactly
    // like the audit sweep below — the resume call does it instead.
    if (!stoppedEarly) {
      const loop = await eraseOrgLoopRuns(prisma, org.id, batchSize, overBudget, dryRun);
      loopRunsDeleted = loop.runs;
      loopLanesDeleted = loop.lanes;
      if (overBudget()) stoppedEarly = true;
    }

    // MOONSHOT #17 — the memory citations, swept BEFORE the Athena block below, which is the first
    // thing on this path that deletes OrgMemory rows. Ordering, not tidiness: a citation left behind
    // by a budget-stopped run would point at a memory that no longer exists. See
    // eraseOrgMemoryCitations.
    if (!stoppedEarly) {
      memoryCitationsDeleted = await eraseOrgMemoryCitations(prisma, org.id, batchSize, overBudget, dryRun);
      if (overBudget()) stoppedEarly = true;
    }

    // Athena: org-scoped like the loop history, and tenant data for the same reason — her threads are
    // the operator's words and her self-model is a document about this organization. Includes the
    // OrgMemory rows she wrote (`source: "athena"`) and NOTHING else in that store; see eraseOrgAthena.
    if (!stoppedEarly) {
      const athena = await eraseOrgAthena(prisma, org.id, batchSize, overBudget, dryRun);
      athenaThreadsDeleted = athena.threads;
      athenaTurnsDeleted = athena.turns;
      athenaProposalsDeleted = athena.proposals;
      athenaIdentityDeleted = athena.identity;
      athenaMemoriesDeleted = athena.memories;
      if (overBudget()) stoppedEarly = true;
    }

    // The wave-1 ledgers: outcomes, the LLM meter, the memory mirror, the control ledger, the
    // registry knowledge/conformance/signals tables and the lessons/trace/proposal lane. Org-scoped
    // and always erased for the same reason the loop history is — tenant data, not compliance
    // evidence, so there is no disposition to choose. See eraseOrgLedgers.
    if (!stoppedEarly) {
      const led = await eraseOrgLedgers(prisma, org.id, batchSize, overBudget, dryRun);
      outcomesDeleted += led.outcomes;
      usageEventsDeleted = led.usageEvents;
      memoryMirrorsDeleted += led.memoryMirrors;
      conformanceReportsDeleted = led.conformanceReports;
      conformanceFindingsDeleted = led.conformanceFindings;
      skillLessonsDeleted = led.skillLessons;
      skillTracesDeleted = led.skillTraces;
      memoryProposalsDeleted = led.memoryProposals;
      registryLedgerDeleted = led.registryLedger;
      laneOutcomesDeleted = led.laneOutcomes;
      memoryCandidatesDeleted = led.memoryCandidates;
      practiceAdoptionsDeleted += led.practiceAdoptions;
      housePatternsDeleted = led.housePatterns;
      scanJobsDeleted = led.scanJobs;
      controlObservationsDeleted = led.controlObservations;
      controlSealsDeleted = led.controlSeals;
      // `+=`, like the mirror and the adoption ledger above: on a REPO-scoped erase `eraseRepo` has
      // already taken that repo's row and this org sweep never runs, so the two never double-count.
      repoAdmissionsDeleted += led.repoAdmissions;
      installationsDeleted = led.installations;
      if (overBudget()) stoppedEarly = true;
    }

    // Audit trail: org-scoped, NO date cutoff (this is erasure, not retention). Opt-in, and skipped
    // once the budget is spent so the resume call does it instead.
    if (auditDisposition !== "keep" && !stoppedEarly) {
      if (dryRun) {
        // Preview: one count over the SAME `{ orgId }` predicate both branches below sweep — the number
        // shown is the number of rows the confirmed run will destroy or redact.
        const inScope = await prisma.auditLog.count({ where: { orgId: org.id } });
        if (auditDisposition === "delete") auditDeleted = inScope;
        else auditRedacted = inScope;
      } else if (auditDisposition === "delete") {
        auditDeleted = await pruneAudit(prisma, { orgId: org.id }, batchSize, overBudget);
      } else {
        auditRedacted = await redactOrgAudit(prisma, org.id, batchSize, new Date(now()).toISOString(), overBudget);
      }
      if (overBudget()) stoppedEarly = true;
    }
  }

  // A preview writes nothing, so there is nothing to trace: return the would-erase counts and stop
  // before the `data.erased` write. `audited: true` here means "no trace is owed", not "a trace exists".
  if (dryRun) {
    return {
      ok: true,
      orgSlug: slug,
      scope,
      ...(repoFullName ? { repoFullName } : {}),
      reposProcessed,
      scansDeleted,
      dimensionsDeleted,
      recommendationsDeleted,
      recommendationEventsDeleted,
      loopRunsDeleted,
      loopLanesDeleted,
      athenaThreadsDeleted,
      athenaTurnsDeleted,
      athenaProposalsDeleted,
      athenaIdentityDeleted,
      athenaMemoriesDeleted,
      outcomesDeleted,
      usageEventsDeleted,
      memoryMirrorsDeleted,
      conformanceReportsDeleted,
      conformanceFindingsDeleted,
      digestsDeleted,
      skillLessonsDeleted,
      skillTracesDeleted,
      memoryProposalsDeleted,
      registryLedgerDeleted,
      laneOutcomesDeleted,
      memoryCandidatesDeleted,
      memoryCitationsDeleted,
      practiceAdoptionsDeleted,
      housePatternsDeleted,
      scanJobsDeleted,
      controlObservationsDeleted,
      controlSealsDeleted,
      repoAdmissionsDeleted,
      installationsDeleted,
      auditDeleted,
      auditRedacted,
      auditDisposition,
      stoppedEarly,
      complete: !stoppedEarly,
      audited: true,
      dryRun: true,
    };
  }

  // Written LAST, on purpose — see the AUDIT ORDERING note above. This row is what remains of the
  // trail after an audit-including erasure.
  const audited = await recordAudit(
    ERASE_ACTION,
    {
      scope,
      ...(repoFullName ? { repo: repoFullName } : {}),
      // Both are recorded: the disposition is what an examiner needs to read off the surviving row to
      // know whether the trail beside it was destroyed, redacted, or left alone. `includeAudit` stays
      // for continuity with entries written before dispositions existed.
      auditDisposition,
      includeAudit: auditDisposition !== "keep",
      reposProcessed,
      scansDeleted,
      dimensionsDeleted,
      recommendationsDeleted,
      recommendationEventsDeleted,
      loopRunsDeleted,
      loopLanesDeleted,
      athenaThreadsDeleted,
      athenaTurnsDeleted,
      athenaProposalsDeleted,
      athenaIdentityDeleted,
      athenaMemoriesDeleted,
      outcomesDeleted,
      usageEventsDeleted,
      memoryMirrorsDeleted,
      conformanceReportsDeleted,
      conformanceFindingsDeleted,
      digestsDeleted,
      skillLessonsDeleted,
      skillTracesDeleted,
      memoryProposalsDeleted,
      registryLedgerDeleted,
      laneOutcomesDeleted,
      memoryCandidatesDeleted,
      memoryCitationsDeleted,
      practiceAdoptionsDeleted,
      housePatternsDeleted,
      scanJobsDeleted,
      controlObservationsDeleted,
      controlSealsDeleted,
      repoAdmissionsDeleted,
      installationsDeleted,
      auditDeleted,
      auditRedacted,
      complete: !stoppedEarly,
    },
    { orgId: org.id, actorId: req.actorId },
  );

  return {
    ok: true,
    orgSlug: slug,
    scope,
    ...(repoFullName ? { repoFullName } : {}),
    reposProcessed,
    scansDeleted,
    dimensionsDeleted,
    recommendationsDeleted,
    recommendationEventsDeleted,
    loopRunsDeleted,
    loopLanesDeleted,
    athenaThreadsDeleted,
    athenaTurnsDeleted,
    athenaProposalsDeleted,
    athenaIdentityDeleted,
    athenaMemoriesDeleted,
    outcomesDeleted,
    usageEventsDeleted,
    memoryMirrorsDeleted,
    conformanceReportsDeleted,
    conformanceFindingsDeleted,
    digestsDeleted,
    skillLessonsDeleted,
    skillTracesDeleted,
    memoryProposalsDeleted,
    registryLedgerDeleted,
    laneOutcomesDeleted,
    memoryCandidatesDeleted,
    memoryCitationsDeleted,
    practiceAdoptionsDeleted,
    housePatternsDeleted,
    scanJobsDeleted,
    controlObservationsDeleted,
    controlSealsDeleted,
    repoAdmissionsDeleted,
    installationsDeleted,
    auditDeleted,
    auditRedacted,
    auditDisposition,
    stoppedEarly,
    complete: !stoppedEarly,
    audited,
    dryRun: false,
  };
}
