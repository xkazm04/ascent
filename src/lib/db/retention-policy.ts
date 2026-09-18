// Retention policy and purge contracts. No database access or deletion side effects.
// Public exports remain available from retention.ts for existing callers.


/** Audit action recorded by the purge job for each org it enforces a policy on. */
export const PURGE_ACTION = "retention.purged";

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

/** The four Organization override columns owners set from Settings. `null` = inherit the env default. */
export interface OrgRetentionColumns {
  retentionMaxScans: number | null;
  retentionAuditDays: number | null;
  retentionCompact: boolean | null;
  retentionDigestMonths: number | null;
}

/** Stored overrides plus the resolved policy, env defaults, and floors the Settings card renders. */
export interface OrgRetentionView {
  stored: OrgRetentionColumns;
  defaults: RetentionPolicy;
  effective: RetentionPolicy;
  compactDefault: boolean;
  digestMonthsDefault: number;
  floors: { maxScansPerRepo: number; auditDays: number };
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


/** What a single org's (or the orphan sweep's) purge removed. */
export interface OrgPurgeResult {
  orgSlug: string;
  policy: RetentionPolicy;
  scansDeleted: number;
  dimensionsDeleted: number;
  recommendationsDeleted: number;
  recommendationEventsDeleted: number;
  auditDeleted: number;
  /** InterventionOutcome rows that died with their scan bookends (moonshot #9). Counted in a dry
   *  run over the same OR-of-bookends predicate the delete uses. */
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
   *  counts are per-repo would-delete totals; dependent dimension/recommendation(-event)/outcome
   *  rows and conformance findings are counted over the same predicates the delete uses — a 0 is
   *  measured, not a skipped placeholder (G4). */
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
  /** Restrict to one org (Settings preview). Fleet-wide orphan/queue/quota sweeps are skipped. */
  onlyOrgSlug?: string;
  /** Proposed Organization columns, overlaid only when `dryRun` is true (never on a real purge). */
  proposed?: OrgRetentionColumns;
}
export { parseNonNegInt };

/**
 * Parse a nullable non-negative integer override. `undefined` = key absent; `null` / blank = inherit;
 * a non-integer or negative value is `false` (invalid). Unlike {@link parseNonNegInt}, floats are
 * refused rather than floored — a typed `4.9` must not silently become a 4-scan keep-window.
 */
export function parseRetentionInt(v: unknown): number | null | undefined | false {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  if (typeof v !== "number" && typeof v !== "string") return false;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return false;
  return n;
}

/** Parse a nullable boolean override. `undefined` = absent; `null` / blank = inherit; `"invalid"` otherwise.
 *  Cannot use `false` as the bad-sentinel: `false` is a legal "compaction off" write. */
export function parseRetentionBool(v: unknown): boolean | null | undefined | "invalid" {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v === "boolean") return v;
  return "invalid";
}

/**
 * Floor check on STORED overrides. `null` (inherit) and `0` (keep everything) are never floored;
 * a configured-but-nonzero window below {@link RETENTION_MIN_SCANS_PER_REPO} / {@link RETENTION_MIN_AUDIT_DAYS}
 * is the fat-finger the Settings write refuses. Does not lower the floors.
 */
export function retentionFloorViolations(
  stored: Pick<OrgRetentionColumns, "retentionMaxScans" | "retentionAuditDays">,
): string[] {
  const out: string[] = [];
  if (
    stored.retentionMaxScans != null &&
    stored.retentionMaxScans > 0 &&
    stored.retentionMaxScans < RETENTION_MIN_SCANS_PER_REPO
  ) {
    out.push(`retentionMaxScans=${stored.retentionMaxScans} < ${RETENTION_MIN_SCANS_PER_REPO}`);
  }
  if (
    stored.retentionAuditDays != null &&
    stored.retentionAuditDays > 0 &&
    stored.retentionAuditDays < RETENTION_MIN_AUDIT_DAYS
  ) {
    out.push(`retentionAuditDays=${stored.retentionAuditDays} < ${RETENTION_MIN_AUDIT_DAYS}`);
  }
  return out;
}

export type ParseRetentionBody =
  | { ok: true; stored: OrgRetentionColumns }
  | { ok: false; error: string; belowFloor?: boolean };

/** Validate the four Settings fields. All four keys are required (full replace, not a patch). */
export function parseOrgRetentionBody(body: {
  retentionMaxScans?: unknown;
  retentionAuditDays?: unknown;
  retentionCompact?: unknown;
  retentionDigestMonths?: unknown;
}): ParseRetentionBody {
  const retentionMaxScans = parseRetentionInt(body.retentionMaxScans);
  const retentionAuditDays = parseRetentionInt(body.retentionAuditDays);
  const retentionCompact = parseRetentionBool(body.retentionCompact);
  const retentionDigestMonths = parseRetentionInt(body.retentionDigestMonths);
  if (
    retentionMaxScans === undefined ||
    retentionAuditDays === undefined ||
    retentionCompact === undefined ||
    retentionDigestMonths === undefined
  ) {
    return {
      ok: false,
      error: "Provide { org, retentionMaxScans, retentionAuditDays, retentionCompact, retentionDigestMonths }.",
    };
  }
  if (
    retentionMaxScans === false ||
    retentionAuditDays === false ||
    retentionCompact === "invalid" ||
    retentionDigestMonths === false
  ) {
    return {
      ok: false,
      error:
        "Retention fields must be null (inherit), 0 (keep everything), or a non-negative integer; compact must be null or a boolean.",
    };
  }
  const stored: OrgRetentionColumns = {
    retentionMaxScans,
    retentionAuditDays,
    retentionCompact,
    retentionDigestMonths,
  };
  const violations = retentionFloorViolations(stored);
  if (violations.length) {
    return {
      ok: false,
      belowFloor: true,
      error:
        `Refusing a policy below the safety floor (${violations.join(", ")}). Use 0 to keep everything, ` +
        `or at least ${RETENTION_MIN_SCANS_PER_REPO} scans / ${RETENTION_MIN_AUDIT_DAYS} audit days.`,
    };
  }
  return { ok: true, stored };
}
