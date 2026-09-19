// Pure decision logic extracted (verbatim) from the report-shell React effects so it can be unit
// tested without a DOM. Two taxonomies the user-facing message hinges on:
//
//  1. classifyHistoryResponse — how a /api/history HTTP response maps to the trend panel state.
//     503 (persistence off) and 401 (signed-out viewer) are LEGITIMATE no-trends modes that keep the
//     quiet "Baseline established" path; any OTHER non-OK status (e.g. a transient 500 from a DSQL
//     token expiry) is a real FAILURE that must surface, not silently render a misleading baseline
//     over months of real history. Mirrors ReportView.tsx history effect.
//
//  2. classifyScanAbort — how a thrown scan error maps to the error copy. An AbortError caused by the
//     180s timeout → "timed out" (with the "try a smaller repository" guidance); an AbortError that
//     ISN'T a timeout (e.g. a connection reset; intentional-unmount aborts are filtered out earlier by
//     the `cancelled` flag) → "interrupted"; anything else → "network". Mirrors ReportClient.tsx catch.
//
// Pure functions — no React, no fetch, no I/O.

/** Trend-panel disposition for a /api/history response. */
export type HistoryDisposition = "ok" | "no-trends" | "error";

/**
 * Classify a /api/history response by its HTTP status.
 * - `ok`        → response was OK; render the fetched/parsed history.
 * - `no-trends` → 503 (persistence off) or 401 (signed-out) — the quiet baseline, NOT an error.
 * - `error`     → any other non-OK status — a genuine failure that must be surfaced.
 */
export function classifyHistoryResponse(status: number, ok: boolean): HistoryDisposition {
  if (ok) return "ok";
  if (status === 503 || status === 401) return "no-trends";
  return "error";
}

/** Which error copy a settled scan attempt should show. `none` = no state change (intentional cancel). */
export type ScanAbortKind = "timeout" | "interrupted" | "network" | "none";

/**
 * Classify a settled scan attempt into the message taxonomy.
 * `cancelled` (intentional unmount/re-run) short-circuits to `none` — the effect leaves state alone.
 * An AbortError then splits on `timedOut`: true → "timeout", false → "interrupted" (e.g. a reset).
 * Any non-abort error → "network".
 */
export function classifyScanAbort(input: {
  name?: string;
  timedOut?: boolean;
  cancelled?: boolean;
}): ScanAbortKind {
  if (input.cancelled) return "none";
  if (input.name === "AbortError") {
    return input.timedOut ? "timeout" : "interrupted";
  }
  return "network";
}
