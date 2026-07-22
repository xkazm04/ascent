// Time model for the live-scan loading view. A live AI scan is dominated almost entirely by the
// LLM call — measured across the team's own repos, GitHub ingest + deterministic analysis + compose
// run in ~2–4s, while the model assessment runs for anything from ~90s (a hosted Gemini/Bedrock model
// under scan.ts's total LLM budget) to MINUTES (claude-cli spawns a full local CLI session per call).
// So the honest expectation must be PROVIDER-AWARE, and the progress bar must keep moving during the
// long score stage instead of freezing at the stage-based percentage.
//
// Why provider-aware: the resolved provider is emitted in every SSE progress frame (scan.ts), and a
// single claude-cli-tuned 6-min estimate made a ~90s hosted scan crawl to ~24% and then jump to done.
// Keying the estimate off the frame's provider makes the same curve honest on both a claude-cli local
// deploy (minutes) and a hosted Gemini/Bedrock deploy (~90s).
//
// CALIBRATION (claude-cli): measured across the team's repos (scripts/scan-timing harness, /api/scan
// fresh=1, LLM_PROVIDER=claude-cli @ default model). Clean wall times: 272/337/357/367/397/486s
// (median ≈ 360s, p90 ≈ 490s); one large repo ran >11min and degraded to mock. Re-measure and lower
// these if the model changes — CLAUDE_MODEL=haiku or an API provider would shift them down.

import type { ProviderName } from "@/lib/types";

/** claude-cli: a full local CLI session per call — measured ~272–486s (median ≈ 360s). */
export const CLAUDE_CLI_ESTIMATE_MS = 360_000; // ~6 min (measured median)
/**
 * Hosted providers (Gemini / Bedrock / OpenAI / OpenRouter) run under scan.ts's ~90s total LLM budget
 * (llmTotalBudgetMs), which sits below a serverless route's maxDuration. Add the fixed GitHub ingest +
 * deterministic analysis + compose overhead (~2–4s, rounded up) so the curve reaches high territory as
 * the scan approaches that budget rather than crawling to ~24% and jumping.
 */
export const HOSTED_ESTIMATE_MS = 100_000; // ~90s LLM budget + ingest/analyze/compose overhead
/** The deterministic mock never calls a model — a scan is just ingest + analysis + compose. */
export const MOCK_ESTIMATE_MS = 8_000;

/**
 * Typical (≈p50) wall-clock for a fresh live scan, keyed off the RESOLVED provider (every SSE progress
 * frame carries it). Undefined — before the first frame names the provider — assumes the SLOWEST
 * provider, so a later resolution can only SHORTEN the estimate: the time-driven curve then moves
 * forward, never backward (the bar's forward-only invariant).
 */
export function scanEstimateMs(provider?: ProviderName): number {
  switch (provider) {
    case "claude-cli":
      return CLAUDE_CLI_ESTIMATE_MS;
    case "mock":
      return MOCK_ESTIMATE_MS;
    case "gemini":
    case "bedrock":
    case "openai":
    case "openrouter":
      return HOSTED_ESTIMATE_MS;
    default:
      // Pre-first-frame / unknown: assume the slowest provider so resolving it can only speed the bar up.
      return CLAUDE_CLI_ESTIMATE_MS;
  }
}

/**
 * Client-side abort backstop for a live scan, in useReportScan. Derived from the per-provider estimate
 * (≈2× the typical) rather than a fixed ceiling, so it sits ABOVE the slowest real scan for that
 * provider (and above the server's LLM budget / CLI timeout) yet still bounds a genuine hang. The old
 * fixed 12-min value is exactly the claude-cli case here (360s × 2); a hosted deploy now gives up on a
 * true hang in ~200s instead of waiting 12 min. This is only the runaway backstop — the scan normally
 * resolves via its SSE `result` frame well before it. Provider is unknown at scan start, so the caller
 * starts at the undefined (slowest) value and TIGHTENS it once the resolved provider arrives.
 */
export function scanClientTimeoutMs(provider?: ProviderName): number {
  return scanEstimateMs(provider) * 2;
}

/**
 * Time-driven progress percentage that ALWAYS advances and asymptotically approaches (but never
 * reaches) 100 until the scan actually completes — so a multi-minute (or multi-second-hosted) score
 * stage feels alive instead of stalling at the stage percentage. Reaches ~90% around the typical
 * estimate, then keeps creeping for slower repos. Blended with the server's stage percentage via
 * Math.max at the call site, so it can only ever push the bar forward. Pass the provider-derived
 * estimate (scanEstimateMs) so the curve is calibrated to the model actually running.
 */
export function timeProgressPct(elapsedMs: number, estimateMs: number = scanEstimateMs()): number {
  if (elapsedMs <= 0) return 0;
  const tau = estimateMs / 3; // ~90% at ≈estimate; gentle creep beyond
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
 * Honest expectation copy keyed off how long the scan has already been running, RELATIVE to the
 * provider's estimate. Before the typical estimate: set the expectation. Between typical and the ≈p90
 * long band: reassure it's still working. Past the long band: own that it's slow rather than pretending
 * it's nearly done. The long band scales with the estimate (≈5/3×, preserving claude-cli's 360s→600s).
 */
export function expectationCopy(elapsedMs: number, estimateMs: number = scanEstimateMs()): string {
  const longMs = (estimateMs * 5) / 3; // ≈p90 band (claude-cli: 360s → 600s)
  if (elapsedMs >= longMs) {
    return "This is taking longer than usual — large repositories can take several minutes. Still working…";
  }
  if (elapsedMs >= estimateMs) {
    return "Almost there — wrapping up the assessment.";
  }
  return "A live AI scan reads the repo and scores 9 dimensions — this usually takes a few minutes. You can leave this tab open.";
}
