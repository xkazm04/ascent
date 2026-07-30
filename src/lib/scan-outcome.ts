// Scan-outcome observability. The Scan table records only SUCCESSES — there is no status column and a
// failed run persists nothing — so a scan that dies on an LLM timeout or a GitHub 403 consumes quota and
// LLM spend and leaves no trace anywhere. These counters are that trace, and the denominator for the
// "scan pipeline error rate" KPI.
//
// Four tallies, because "error rate" is only meaningful once user-side outcomes are separated from
// pipeline ones:
//
//   error rate = scan_failed / (scan_started - scan_rejected)
//
// `scan_rejected` covers outcomes the pipeline handled correctly — a typo'd URL, a private repo, an
// empty repo, a client disconnect. Counting those as failures would make a healthy pipeline look broken
// and would move with funnel traffic rather than with reliability.
//
// `scan_degraded` is the quieter failure the KPI's own wording misses: the assess phase falls back to a
// deterministic mock floor rather than throwing, so the user gets a report built without the model and
// the run still counts as a success everywhere else. It is tracked separately rather than folded into
// the error rate, which is defined over terminated scans.
//
// Best-effort throughout, on the same contract as the other counters in src/lib/db: no-op when
// persistence is off, and every write swallows its own errors so observability never breaks a scan.

import { recordQuotaEvent } from "@/lib/db/quota-events";
import { GitHubError } from "@/lib/github/source";

/** A scan run reached the pipeline. The raw denominator, before rejections are subtracted. */
export async function recordScanStarted(): Promise<void> {
  await recordQuotaEvent("scan_started", "all");
}

/** The assess phase fell back to the mock floor — a report was produced without the model. */
export async function recordScanDegraded(providerName: string): Promise<void> {
  await recordQuotaEvent("scan_degraded", providerName);
}

/** Classify a thrown scan error into (bucket, scope). `rejected` is user-side and correctly handled;
 *  `failed` is the pipeline itself. Exported for the unit test — the split is the whole point of the
 *  metric, so it is worth asserting directly rather than only through the counters. */
export function classifyScanFailure(err: unknown): {
  bucket: "rejected" | "failed";
  scope: string;
} {
  // A client disconnect aborts mid-flight. The user left; nothing is broken.
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return { bucket: "rejected", scope: "aborted" };
  }
  if (err instanceof GitHubError) {
    switch (err.code) {
      case "INVALID_URL":
        return { bucket: "rejected", scope: "invalid_url" };
      case "NOT_FOUND":
        return { bucket: "rejected", scope: "not_found" };
      case "EMPTY":
        return { bucket: "rejected", scope: "empty_repo" };
      case "RATE_LIMITED":
        return { bucket: "failed", scope: "github_rate_limited" };
      case "UPSTREAM":
        // A 403 here is an auth/permission failure on our side of the call, not a missing repo.
        return { bucket: "failed", scope: err.status ? `github_${err.status}` : "github_upstream" };
    }
  }
  return { bucket: "failed", scope: "unknown" };
}

/** Tally a thrown scan error into the bucket its classification names. */
export async function recordScanFailure(err: unknown): Promise<void> {
  const { bucket, scope } = classifyScanFailure(err);
  await recordQuotaEvent(bucket === "rejected" ? "scan_rejected" : "scan_failed", scope);
}
