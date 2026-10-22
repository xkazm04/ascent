// Shared post-scan orchestration for the two single-repo scan entry points — /api/scan (sync JSON)
// and /api/scan/stream (SSE). Both carried near-identical copies of three coupled, money-/cache-safety
// invariants: the monthly public-quota consume+refund, the degrade-to-mock / low-coverage classification,
// and the "skip cache + skip persist on degrade" guard. The duplicate copies had to stay byte-aligned or
// a fix to one route silently regressed the other (the routes' own tests exist to catch exactly that).
// These helpers are the exact union of the two former copies; each route keeps its own surfacing (a JSON
// response vs SSE events) and calls the shared refund()/persist routine.

import { cacheSet } from "@/lib/cache";
import { getScanReportByCommit, isDbConfigured, persistScanReport } from "@/lib/db";
import {
  consumePublicScanQuota,
  refundPublicScanQuota,
  monthlyQuotaExceeded,
  type QuotaScope,
} from "@/lib/public-scan-quota";
import { getViewer } from "@/lib/access";
import { degradeTo } from "@/lib/scan-read-door";
import type { ScanReport } from "@/lib/types";
import type { ScanCacheLookup } from "@/lib/scan-cache";
// The classification moved to scan-consequences.ts (the fleet executors share it); re-exported so
// every existing importer of this module is unchanged.
import { classifyScanResult, isAuthoritativeScanResult, runScanConsequences, type ScanResultClass } from "@/lib/scan-consequences";
export { classifyScanResult, isAuthoritativeScanResult, type ScanResultClass };

/** Quota header fields surfaced to the client (only set when the monthly gate actually enforced). */
export interface ScanQuotaHeaders {
  quotaRemaining: number | null;
  quotaResetAt: number | null;
  quotaScope: QuotaScope | null;
}

export interface ScanQuotaResult extends ScanQuotaHeaders {
  /**
   * A ready-to-return 402-equivalent Response when the monthly quota is exceeded; null when the scan
   * may proceed. The caller returns it directly (JSON route) or before opening the stream.
   */
  blocked: Response | null;
  /**
   * Refund the consumed monthly slot. No-op unless a slot was actually charged; idempotent (at most one
   * refund per consumed slot). Called on degrade-to-mock / cached-hit / failure — the free tier meters
   * on commit, not attempt.
   */
  refund: () => Promise<void>;
}

const noopQuota: ScanQuotaResult = {
  blocked: null,
  quotaRemaining: null,
  quotaResetAt: null,
  quotaScope: null,
  refund: async () => {},
};

/**
 * Monthly SOFT gate for public scans: publicScanAllowance() / publicScanMonthlyLimit(), bucketed
 * per-user (signed-in) or per-IP (anon). Applies to every anonymous public scan, not a Free-plan
 * entitlement. Only real, public, non-mock scans count (a cache hit / peek / private token scan skips
 * this). Consumes one slot and returns the header fields + a `refund()` thunk that hits the same
 * bucket the slot was charged to. Fails open (proceeds) when persistence isn't configured. Identical
 * in both scan routes.
 */
export async function consumeScanQuota(
  req: Request,
  opts: { orgSlug: string; token: string | undefined; mock: boolean },
): Promise<ScanQuotaResult> {
  if (!(opts.orgSlug === "public" && !opts.token && !opts.mock)) return noopQuota;

  const viewer = await getViewer();
  const quota = await consumePublicScanQuota(req, { viewerId: viewer?.id });
  if (quota.enforced && !quota.allowed) {
    return { ...noopQuota, blocked: monthlyQuotaExceeded(quota) };
  }
  if (!quota.enforced) return noopQuota;

  // Carry the viewer identity + the exact charged-at timestamp so the refund recomputes the identical
  // bucket key and removes THE slot this request charged.
  let charged: { viewerId: string | null; chargedAt: number | null } | null = {
    viewerId: viewer?.id ?? null,
    chargedAt: quota.chargedAt,
  };
  const refund = async () => {
    if (charged) {
      await refundPublicScanQuota(req, { viewerId: charged.viewerId }, charged.chargedAt);
      charged = null; // at most one refund per consumed slot
    }
  };
  return {
    blocked: null,
    quotaRemaining: quota.remaining,
    quotaResetAt: quota.resetAt,
    quotaScope: quota.signedIn ? "user" : "anon",
    refund,
  };
}

/**
 * Cache + persist a scan report behind the shared cache-poisoning guards: skip BOTH the in-memory cache
 * (cacheSet) and the durable store (persistScanReport) when the report degraded to mock or is low-coverage,
 * so getScanReportByCommit's DB tier can't re-serve the deterministic floor cross-instance under ::llm.
 * Returns `deduped` (whether the commit was already scored — no new row), `persistedOk` (false when an
 * atomic persist threw and the whole scan rolled back), and `durable` (true only when THIS report is
 * in the durable store — new row or dedup — so a `/report/{owner}/{repo}` permalink will resolve).
 * The JSON route uses `deduped`/`persistedOk` for its refund + degraded-persist header; the stream
 * route emits `durable` as the `persisted` SSE frame so the live-scan client can rewrite the address
 * bar without advertising a cold permalink.
 */
export async function cacheAndPersistScan(
  report: ScanReport,
  cls: ScanResultClass,
  opts: {
    tag: string;
    repo: string;
    orgSlug: string;
    lookup: ScanCacheLookup | null;
    /**
     * `false` for a SCOPED scan — one aimed at a non-default git ref and/or a monorepo sub-path
     * (G7-07 / G7-08). Such a report is about a DIFFERENT SUBJECT than "this repository": the corpus
     * reads a repo's most recent persisted row as its current standing (the leaderboard, /report's
     * "latest", org rollups, the regression alert baseline), so writing a feature-branch or
     * single-package score there would silently redefine what the repo scores and could fire a
     * regression alert against a branch that was never the baseline. It also closes the trust hole a
     * client-supplied ref would otherwise open (a cherry-picked flattering commit scored, saved, and
     * later served as the repo's public reading — the same reason /api/scan/stream refuses a
     * client-supplied headSha).
     *
     * The IN-MEMORY cache is still written: its key carries the ref's own commit sha plus an explicit
     * sub-path segment (see makeCacheKey's `scope`), so a scoped entry provably cannot be read by, or
     * overwrite, a whole-repo reader of that commit. Defaults to true — every existing caller is
     * unaffected.
     */
    persist?: boolean;
  },
): Promise<{ deduped: boolean; persistedOk: boolean; durable: boolean }> {
  const { lookup, persist = true } = opts;
  // A truncated PR slice is the third poisoning vector, alongside a mock fallback and low coverage: its
  // D6/D7/D8 scores understate reality, so caching or persisting it would serve a deflated verdict to
  // every later reader of this commit. graphql.ts always documented this; nothing enforced it.
  // Derived vector-agnostically so a FOURTH one needs no edit here (see isAuthoritativeScanResult).
  const authoritative = isAuthoritativeScanResult(cls);

  // The in-memory cache is the SHARED ANONYMOUS tier: every later anonymous scan or peek of this commit
  // is served from it. A private report must never land there — it can reach this point through the
  // ambient operator PAT (an owner with no stored installation), and the DB row it persists is re-tenanted
  // off 'public', so this write was the one leak left (lite r1, robustness-2). scan-cache.ts refuses to
  // serve one from memory as well, so either half alone closes it.
  if (lookup && authoritative && report.repo?.isPrivate !== true) cacheSet(lookup.cacheKey, report);

  let deduped = false;
  let persistedOk = true;
  // Whether a NEW authoritative scored row was written this call (persisted, truthy, not a commit
  // dedup) — the trigger for the interactive regression alert below, mirroring the cron/webhook guard.
  let newRowWritten = false;
  if (persist && isDbConfigured() && authoritative) {
    // Capture the repo's latest persisted report BEFORE the fresh one lands, so the interactive
    // regression check below can diff against it (checkAndAlertRegression's caller contract: capture
    // `prev` before persisting). Best-effort — a failed read just yields a null baseline (first-scan no-op).
    const prev = await getScanReportByCommit(report.repo.owner, report.repo.name, {
      orgSlug: opts.orgSlug,
    }).catch(degradeTo(`${opts.tag}: regression baseline (getScanReportByCommit)`, null));
    try {
      const persisted = await persistScanReport(report, { orgSlug: opts.orgSlug, headEtag: lookup?.etag ?? undefined });
      deduped = persisted?.deduped ?? false;
      newRowWritten = !!persisted && !persisted.deduped;
      // No partial-write inspection here: persistence is atomic — a partial failure THROWS (handled
      // below) rather than returning a degraded result (scan-persistence-history 07-16 #3).
    } catch (err) {
      persistedOk = false;
      console.error(`[${opts.tag}] persistence failed`, err);
    }
    // Live intelligence on a NEW scored row (skips a dedup/failed persist): the adoption ledger, the
    // regression alert and the scan memories, through the one consequence seam every executor shares
    // (src/lib/scan-consequences.ts). Kept OUTSIDE the persist try so a consequence hiccup can't flip
    // persistedOk; runScanConsequences never rejects and the alert honors the SAME per-repo cooldown
    // claim, so it can neither double-alert with cron nor fail the scan.
    if (newRowWritten) await runScanConsequences(prev, report, { orgSlug: opts.orgSlug, tag: opts.tag });
  }
  // True only when a later `/report/{owner}/{repo}` hit will serve THIS scan. DB-off, scoped,
  // non-authoritative, and a thrown persist all stay false — rewriting the live-scan address bar
  // in those cases would land a reload on ColdScanGate under a URL that looks scored.
  const durable = Boolean(persist && authoritative && persistedOk && isDbConfigured());
  return { deduped, persistedOk, durable };
}
