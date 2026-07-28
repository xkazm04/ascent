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

// ── Posture transition hysteresis ─────────────────────────────────────────────
//
// The posture quadrant cuts at exactly POSTURE_THRESHOLD (50) on each axis, so a repo sitting at 49/51
// can flip its headline label on a re-scan of an unchanged commit — the same ±1 wobble the band above
// already suppresses for numeric deltas. A LABEL flip is worse than a numeric one: it fires a critical
// alert, rewrites the briefing headline, and reads to a customer as a real change of posture.
//
// The fix is deliberately scoped to ANNOUNCEMENTS, not to classification. `postureFor` stays a pure
// function of the two axis scores — no call site needs prior state, no repo re-labels on deploy, and
// the stored posture keeps meaning exactly what it has always meant. What changes is when a crossing is
// worth TELLING someone about: entering a quadrant needs the axes clear of the cut by the noise band,
// and leaving needs them clear on the way down. Inside the 48–52 corridor the crossing is real
// arithmetic but not real evidence, so it reads as "held".
//
// Asymmetric on purpose: enter high (≥52) and leave low (<48) means a repo that genuinely climbs is
// announced once, and does not un-announce itself on the next scan's wobble.

/** Axis score at or above which a quadrant ENTRY is worth announcing. */
export const POSTURE_ENTER = 52;
/** Axis score below which a quadrant EXIT is worth announcing. */
export const POSTURE_LEAVE = 48;

/**
 * Should a posture change be announced (alert, headline, movers), or is it corridor wobble?
 *
 * `before`/`after` are the two postures as classified; `axes` are the CURRENT axis scores, which is
 * what the corridor test is applied to. Returns "held" when the label technically changed but the axes
 * are still inside the 48–52 corridor — the caller should treat that as no news.
 */
export function postureTransition(
  before: string,
  after: string,
  axes: { adoption: number; rigor: number },
): "entered" | "left" | "held" {
  if (before === after) return "held";
  // A crossing is only news when the axis that moved is clear of the corridor. Both axes are checked
  // because either one can flip the quadrant, and a change driven by an axis still sitting at 50 is
  // exactly the case this exists to suppress.
  const decisive = (v: number) => v >= POSTURE_ENTER || v < POSTURE_LEAVE;
  if (!decisive(axes.adoption) && !decisive(axes.rigor)) return "held";
  // Direction is defined by the destination, not by score arithmetic: "entered" means the repo now
  // holds a quadrant it did not hold before. Callers that care about a SPECIFIC quadrant (the
  // ungoverned slide, say) still compare the ids themselves — this only answers "is it news?".
  return after === "ai-native" || before === "getting-started" ? "entered" : "left";
}
