// Score-noise band — the canonical "is this move real, or scan-to-scan noise?" primitive.
//
// A maturity score is the deterministic signal blended 60/40 with an LLM judgment that is guardbanded
// ±25 to that signal (see scoring/engine.ts + maturity/model.ts). In practice the blended score barely
// moves run-to-run: two INDEPENDENT claude-cli re-scans of the SAME commit (UAT pricing-20 L2,
// 2026-06-20) moved 0 points overall and ±1 per dimension — far under the 5-point regression-alert
// threshold (lib/alerts.ts DEFAULT_THRESHOLDS.overallDrop). So a small period-over-period delta is
// statistically indistinguishable from that wobble.
//
// The trajectory card already says this for the *trend* (R² "trend confidence · noisy"). This band
// carries the same honesty to every DISCRETE delta — a movers tile, a dimension row, a digest line —
// so a +1 never wears the same confident green arrow as a +8. Pure + dependency-free so both the lib
// (alerts/digest) and the presentational layer (delta formatters) share one source of truth.

/** Half-width of the noise band, in score points. |delta| <= this reads as "held", not a real move. */
export const SCORE_NOISE_BAND = 2;

/** True when a score delta is small enough to be scan-to-scan noise rather than real movement. */
export function isWithinNoise(delta: number): boolean {
  return Math.abs(delta) <= SCORE_NOISE_BAND;
}

/** Classify a score delta for display: a real climb/slide, or noise/flat. */
export function classifyDelta(delta: number): "up" | "down" | "noise" {
  if (isWithinNoise(delta)) return "noise";
  return delta > 0 ? "up" : "down";
}
