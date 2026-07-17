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
export const RETENTION_DEFAULT_TIME_BUDGET_MS = PURGE_MAX_DURATION_S * 1000 - RETENTION_BUDGET_HEADROOM_MS;
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

/** Per-repo: delete every scan beyond the newest `max`, with its dimensions + recommendations. */
async function pruneRepoScans(
  prisma: PrismaLike,
  repoId: string,
  max: number,
  batchSize: number,
  budgetExceeded?: () => boolean,
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
    budgetExceeded, // stop between batches once the run is over budget (data-retention #1)
  );
  return { scans, dimensions, recommendations, events };
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
  /** True when the wall-clock budget stopped the run before every org/sweep was reached this tick — a
   *  partial run (data-retention #2). The next tick re-shuffles and resumes the unreached orgs. */
  stoppedEarly: boolean;
  /** Orgs left unprocessed when the run stopped early (0 on a complete run) — the resume tail. */
  orgsRemaining: number;
}

/** Options for {@link purgeExpiredData}. The clock is injectable so the budget + the per-tick rotation
 *  (which is DERIVED from the clock, not from an RNG) are deterministically testable. */
export interface PurgeOptions {
  actorId?: string;
  /** Wall-clock budget (ms) for the org loop; defaults to RETENTION_TIME_BUDGET_MS env or 250_000. */
  timeBudgetMs?: number;
  /** Monotonic-ish clock (ms). Defaults to Date.now. Also seeds the per-tick rotation offset. */
  now?: () => number;
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
  const timeBudgetMs = opts.timeBudgetMs ?? (envBudget || RETENTION_DEFAULT_TIME_BUDGET_MS);
  // Budget/cap coupling warning (data-retention 07-16 #1): a budget at or beyond the route's declared
  // maxDuration can never trip BEFORE the platform kill, so the "stop cleanly with a summary" guarantee
  // is silently void. Warn (env-configured budgets only — injected test budgets are deliberate).
  if (envBudget != null && envBudget >= PURGE_MAX_DURATION_S * 1000) {
    console.warn(
      `[retention] RETENTION_TIME_BUDGET_MS=${envBudget} >= the route's maxDuration (${PURGE_MAX_DURATION_S}s) — ` +
        `the budget will never trip before the platform kills the function; set it below the plan's real cap`,
    );
  }
  const startedAt = now();

  const orgs = await prisma.organization.findMany({
    select: { id: true, slug: true, retentionMaxScans: true, retentionAuditDays: true },
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
  const overBudget = () => now() - startedAt >= timeBudgetMs;

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
    // Nothing to enforce for this org — skip (don't write a no-op audit entry).
    if (policy.maxScansPerRepo <= 0 && policy.auditDays <= 0) continue;

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

    try {
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
            const r = await pruneRepoScans(prisma, repo.id, policy.maxScansPerRepo, policy.batchSize, overBudget);
            scansDeleted += r.scans;
            dimensionsDeleted += r.dimensions;
            recommendationsDeleted += r.recommendations;
            recommendationEventsDeleted += r.events;
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
        scansDeleted + dimensionsDeleted + recommendationsDeleted + recommendationEventsDeleted + auditDeleted;
      if (partialDeleted > 0) {
        results.push({
          orgSlug: org.slug,
          policy,
          scansDeleted,
          dimensionsDeleted,
          recommendationsDeleted,
          recommendationEventsDeleted,
          auditDeleted,
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
      const auditDeleted = await pruneAudit(prisma, { orgId: null, at: { lt: cutoff } }, defaults.batchSize, overBudget);
      if (overBudget()) stoppedEarly = true;
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
  // Runs on every pass (it's not governed by a per-org retention window) unless the run is already
  // over its time budget, in which case it's deferred to the next pass; best-effort.
  if (overBudget()) {
    stoppedEarly = true;
  } else {
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
    results,
    errors,
    stoppedEarly,
    orgsRemaining,
  };
}
