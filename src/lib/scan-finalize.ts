// Shared post-scan orchestration for the two single-repo scan entry points — /api/scan (sync JSON)
// and /api/scan/stream (SSE). Both carried near-identical copies of three coupled, money-/cache-safety
// invariants: the weekly public-quota consume+refund, the degrade-to-mock / low-coverage classification,
// and the "skip cache + skip persist on degrade" guard. The duplicate copies had to stay byte-aligned or
// a fix to one route silently regressed the other (the routes' own tests exist to catch exactly that).
// These helpers are the exact union of the two former copies; each route keeps its own surfacing (a JSON
// response vs SSE events) and calls the shared refund()/persist routine.

import { cacheSet } from "@/lib/cache";
import { isDbConfigured, persistScanReport } from "@/lib/db";
import { consumePublicScanQuota, refundPublicScanQuota, weeklyQuotaExceeded } from "@/lib/public-scan-quota";
import { getViewer } from "@/lib/access";
import type { ScanReport } from "@/lib/types";
import type { ScanCacheLookup } from "@/lib/scan-cache";

/** Quota header fields surfaced to the client (only set when the weekly gate actually enforced). */
export interface ScanQuotaHeaders {
  quotaRemaining: number | null;
  quotaResetAt: number | null;
  quotaScope: "anon" | "user" | null;
}

export interface ScanQuotaResult extends ScanQuotaHeaders {
  /**
   * A ready-to-return 402-equivalent Response when the weekly quota is exceeded; null when the scan
   * may proceed. The caller returns it directly (JSON route) or before opening the stream.
   */
  blocked: Response | null;
  /**
   * Refund the consumed weekly slot. No-op unless a slot was actually charged; idempotent (at most one
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
 * Weekly SOFT gate for public scans: a free per-window allowance, elevated for a signed-in viewer.
 * Only real, public, non-mock scans count (a cache hit / peek / private token scan skips this). Consumes
 * one slot and returns the header fields + a `refund()` thunk that hits the same bucket the slot was
 * charged to. Fails open (proceeds) when persistence isn't configured. Identical in both scan routes.
 */
export async function consumeScanQuota(
  req: Request,
  opts: { orgSlug: string; token: string | undefined; mock: boolean },
): Promise<ScanQuotaResult> {
  if (!(opts.orgSlug === "public" && !opts.token && !opts.mock)) return noopQuota;

  const viewer = await getViewer();
  const quota = await consumePublicScanQuota(req, { viewerId: viewer?.id });
  if (quota.enforced && !quota.allowed) {
    return { ...noopQuota, blocked: weeklyQuotaExceeded(quota) };
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

/** The cache-poisoning guards: a degrade-to-mock or low-coverage report must skip both caches. */
export interface ScanResultClass {
  /** The LLM was requested but the engine fell back to MockProvider (transient failure) — no real
   *  inference, deterministic floor, so it must NOT be cached/persisted under the ::llm key. */
  degradedToMock: boolean;
  /** Silent per-file fetch failures degraded coverage without failing the LLM — skip caching too. */
  lowCoverage: boolean;
}

/** Derive the cache-poisoning guards from a report. Identical in both scan routes. */
export function classifyScanResult(report: ScanReport, mock: boolean): ScanResultClass {
  return {
    degradedToMock: report.engine.provider === "mock" && !mock,
    lowCoverage: report.confidence < 0.5,
  };
}

/**
 * Cache + persist a scan report behind the shared cache-poisoning guards: skip BOTH the in-memory cache
 * (cacheSet) and the durable store (persistScanReport) when the report degraded to mock or is low-coverage,
 * so getScanReportByCommit's DB tier can't re-serve the deterministic floor cross-instance under ::llm.
 * Returns `deduped` (whether the commit was already scored — no new row) and `persistedOk` (false when an
 * atomic persist threw and the whole scan rolled back). The stream route ignores both; the JSON route uses
 * them for its dedup-refund + degraded-persist header.
 */
export async function cacheAndPersistScan(
  report: ScanReport,
  cls: ScanResultClass,
  opts: {
    tag: string;
    repo: string;
    orgSlug: string;
    lookup: ScanCacheLookup | null;
  },
): Promise<{ deduped: boolean; persistedOk: boolean }> {
  const { degradedToMock, lowCoverage } = cls;
  const { lookup } = opts;

  if (lookup && !degradedToMock && !lowCoverage) cacheSet(lookup.cacheKey, report);

  let deduped = false;
  let persistedOk = true;
  if (isDbConfigured() && !degradedToMock && !lowCoverage) {
    try {
      const persisted = await persistScanReport(report, { orgSlug: opts.orgSlug, headEtag: lookup?.etag ?? undefined });
      deduped = persisted?.deduped ?? false;
      if (persisted && (persisted.failures.audit || persisted.failures.contributors > 0)) {
        console.warn(`[${opts.tag}] persisted with partial write failures`, {
          repo: opts.repo,
          scanId: persisted.scanId,
          auditFailed: persisted.failures.audit,
          contributorFailures: persisted.failures.contributors,
        });
      }
    } catch (err) {
      persistedOk = false;
      console.error(`[${opts.tag}] persistence failed`, err);
    }
  }
  return { deduped, persistedOk };
}
