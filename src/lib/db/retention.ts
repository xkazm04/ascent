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
import { purgeStalePublicScanQuota } from "@/lib/public-scan-quota";

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
  countOnly = false,
): Promise<{ scans: number; dimensions: number; recommendations: number; events: number }> {
  let scans = 0;
  let dimensions = 0;
  let recommendations = 0;
  let events = 0;
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
    return { scans: Math.max(0, total - max), dimensions: 0, recommendations: 0, events: 0 };
  }
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
          where,
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
        }
        if (policy.auditDays > 0) {
          const cutoff = new Date(now() - policy.auditDays * DAY_MS);
          auditDeleted = await prisma.auditLog.count({ where: { orgId: org.id, at: { lt: cutoff } } });
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
  let stoppedEarly = false;

  // Erase ONE repo's scan graph + reset its scan-derived caches. Each batch inside pruneRepoScans is
  // its own committed transaction (bounded); the cache reset follows the deletes so a mid-erase stop
  // never leaves "no scans but a stale passport" — worst case the caches are reset on the resume call.
  // In a preview, the SAME call counts instead of deleting (countOnly) and the cache reset is skipped.
  const eraseRepo = async (repoId: string) => {
    const r = await pruneRepoScans(prisma, repoId, 0, batchSize, overBudget, dryRun);
    scansDeleted += r.scans;
    dimensionsDeleted += r.dimensions;
    recommendationsDeleted += r.recommendations;
    recommendationEventsDeleted += r.events;
    reposProcessed++;
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
    await eraseRepo(repo.id);
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
    auditDeleted,
    auditRedacted,
    auditDisposition,
    stoppedEarly,
    complete: !stoppedEarly,
    audited,
    dryRun: false,
  };
}
