// Time model for the live-scan loading view. A live AI scan is dominated almost entirely by the
// LLM call — measured across the team's own repos, GitHub ingest + deterministic analysis + compose
// run in ~2–4s, while the model assessment runs for MINUTES (e.g. claude-cli: ~270–340s on real
// repos). So the honest expectation to set is "a few minutes", and the progress bar must keep moving
// during the long score stage instead of freezing at the stage-based percentage.
//
// CALIBRATION: measured across the team's repos (scripts/scan-timing harness, /api/scan fresh=1,
// LLM_PROVIDER=claude-cli @ default model). Clean wall times: 272/337/357/367/397/486s (median ≈ 360s,
// p90 ≈ 490s); one large repo ran >11min and degraded to mock. Re-measure and lower these if the model
// changes — CLAUDE_MODEL=haiku or an API provider would shift them down substantially.

/** Typical (≈p50) wall-clock for a fresh live scan. Drives the asymptotic progress curve + copy. */
export const SCAN_ESTIMATE_MS = 360_000; // ~6 min (measured median)
/** Upper end (≈p90) — past this we stop implying "almost done" and say it's taking longer than usual. */
export const SCAN_ESTIMATE_LONG_MS = 600_000; // ~10 min

/**
 * Client-side abort backstop for a live scan, in ReportClient. Must sit ABOVE the slowest real scan
 * (and above the server's LLM_TOTAL_BUDGET_MS / CLAUDE_CLI_TIMEOUT_MS) so the browser never aborts a
 * scan that is still legitimately running — the previous 180s ceiling killed every real claude-cli
 * scan (272–486s measured, some >11min) just before it finished, surfacing as "the scan timed out".
 * This is only the runaway backstop; the scan normally resolves via its SSE `result` frame before it.
 */
export const SCAN_CLIENT_TIMEOUT_MS = 720_000; // 12 min

/**
 * Time-driven progress percentage that ALWAYS advances and asymptotically approaches (but never
 * reaches) 100 until the scan actually completes — so a multi-minute score stage feels alive instead
 * of stalling at the stage percentage. Reaches ~95% around the typical estimate, then keeps creeping
 * for slower repos. Blended with the server's stage percentage via Math.max at the call site, so it
 * can only ever push the bar forward.
 */
export function timeProgressPct(elapsedMs: number, estimateMs: number = SCAN_ESTIMATE_MS): number {
  if (elapsedMs <= 0) return 0;
  const tau = estimateMs / 3; // ~95% at ≈estimate; gentle creep beyond
  return 95 * (1 - Math.exp(-elapsedMs / tau));
}

/** "m:ss" for an elapsed/remaining duration (clamped at 0). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Honest expectation copy keyed off how long the scan has already been running. Before the typical
 * estimate: set the "few minutes" expectation. Between typical and long: reassure it's still working.
 * Past the long estimate: own that it's slow rather than pretending it's nearly done.
 */
export function expectationCopy(elapsedMs: number): string {
  if (elapsedMs >= SCAN_ESTIMATE_LONG_MS) {
    return "This is taking longer than usual — large repositories can take several minutes. Still working…";
  }
  if (elapsedMs >= SCAN_ESTIMATE_MS) {
    return "Almost there — wrapping up the assessment.";
  }
  return "A live AI scan reads the repo and scores 9 dimensions — this usually takes a few minutes. You can leave this tab open.";
}
