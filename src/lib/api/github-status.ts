// The single GitHubError → HTTP status mapping.
//
// Two routes consumed the same `GitHubError` class and answered DIFFERENTLY for the same upstream
// condition, because each invented its own mapping:
//
//   src/app/api/scan/route.ts        mapped by `err.code` through a local STATUS record
//   src/app/api/practices/generate   used `err.status ?? 502` off the error itself
//
// `.status` is the status GITHUB returned, and it is populated at only some throw sites, so the two
// disagreed three ways:
//
//   EMPTY        source.ts:596 throws with no status  ->  scan 422,  practices 502
//   INVALID_URL  thrown with no status                ->  scan 400,  practices 502
//   RATE_LIMITED source.ts:395 passes GitHub's RAW status, which for a SECONDARY rate limit is 403
//                (source.ts:390-393 classifies exactly that case)
//                                                     ->  scan 429,  practices 403
//
// The 403 is the one that actually misleads: a client seeing 403 reads "forbidden, stop and fix your
// credentials" when the truth is "you are being throttled, back off and retry" — and the Retry-After
// GitHub sent is right there on the error. NOT_FOUND (404) and UPSTREAM (502) already agreed.
//
// So the mapping is keyed on `code` — the semantic fact this app defines — and `.status` is used only
// where it adds information the code cannot carry. `classifyScanFailure` in src/lib/scan-outcome.ts is
// the same idea for observability buckets; this is its HTTP counterpart.
//
// Architect ADR 2026-08-28-route-response-seam.

import type { GitHubError } from "@/lib/github/source";

/** Canonical HTTP status for a GitHubError, keyed on the semantic code rather than GitHub's own status. */
export function githubErrorStatus(err: GitHubError): number {
  switch (err.code) {
    case "INVALID_URL":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "RATE_LIMITED":
      // Deliberately NOT err.status: GitHub answers a SECONDARY rate limit with 403, which tells a
      // client the opposite of the truth. Throttling is 429 regardless of how GitHub phrased it.
      return 429;
    case "EMPTY":
      return 422;
    case "UPSTREAM":
      // 502 regardless of GitHub's own status: from this app's caller's point of view, every UPSTREAM
      // is "the dependency failed" and there is nothing the caller can do differently for a 500 vs a
      // 503. This is also what BOTH prior mappings already produced, so it is the one code where
      // consolidating changes nothing.
      return 502;
    default:
      return 500;
  }
}

/**
 * Response headers a GitHubError implies. Currently just Retry-After, set from GitHub's own header on
 * a (secondary) rate limit so a client can back off instead of hammering — the pairing that made the
 * scan route classify secondary limits in the first place.
 */
export function githubErrorHeaders(err: GitHubError): Record<string, string> | undefined {
  return err.retryAfterSec ? { "retry-after": String(err.retryAfterSec) } : undefined;
}
