// Model-quality scorecard types + pure ranking helpers for the ONE ascent LLM op (repo-maturity
// assess). The measured data (scripts/matrix/run.mts → bake.mts) is baked into ./matrix-scores.data;
// this module is pure + client-safe (no data, no I/O) so the org settings scorecard can rank models on
// evidence: judged output quality, CALIBRATION accuracy against the labeled bench (does the model land
// the right maturity level), reliability, and speed. See docs/LLM_MODEL_MATRIX.md.

export interface ModelScore {
  /** OpenRouter model slug, e.g. "google/gemini-3.5-flash". */
  model: string;
  /** Mean LLM-as-judge overall (1–10) across the bench repos where the model produced a usable assessment. */
  quality: number;
  /** Per-dimension judge means (transparency; quality is the composite the judge returned). */
  relevance: number;
  correctness: number;
  adherence: number;
  /** Calibration vs the L1–L4 ground truth: share of repos where the predicted level was EXACT / within 1. */
  exact: number;
  within1: number;
  /** Mean |predicted − expected| level distance (lower is better). */
  mae: number;
  /** Share of attempts that returned a usable assessment (didn't error / cover < half the rubric). */
  reliability: number;
  /** Median wall latency of a scored assess() call, ms. */
  p50Ms: number;
  /** Mean output tokens (the cost proxy — no absolute $ axis is booked for these slugs). */
  outTok: number;
  /** Repos measured for this model. */
  n: number;
}

export interface MatrixScores {
  /** ISO timestamp of the run this was baked from. */
  measuredAt: string;
  /** The judge model slug. */
  judge: string;
  /** Number of labeled bench repos in the run (the confidence caveat: small = noisy). */
  repos: number;
  /** Per-model results, in baked order. */
  models: ModelScore[];
}

/** Calibration as a 0–10 score: exact-level agreement is 10, and each level of mean error costs ~3
 *  points (MAE 1 → 7, MAE 2 → 4). Turns the level-distance metric into the same axis as judged quality
 *  so the two can be blended into one rank. */
export function calibrationScore(m: Pick<ModelScore, "mae">): number {
  return Math.round(Math.max(0, Math.min(10, 10 - m.mae * 3)) * 10) / 10;
}

/** Overall rank score 0–10: judged QUALITY (60%) + CALIBRATION (40%), scaled by reliability so a model
 *  that often fails can't top the board on its rare successes. Quality is what the recruiter-of-models
 *  cares about most; calibration guards against fluent-but-miscalibrated output. */
export function overallScore(m: ModelScore): number {
  const blended = 0.6 * m.quality + 0.4 * calibrationScore(m);
  return Math.round(blended * m.reliability * 10) / 10;
}

/** Models ranked best-first by overall score. */
export function rankModels(scores: MatrixScores): ModelScore[] {
  return [...scores.models].sort((a, b) => overallScore(b) - overallScore(a));
}

/** The single best model overall — the pin the org settings recommend. Null when nothing was measured. */
export function bestModel(scores: MatrixScores): ModelScore | null {
  return rankModels(scores)[0] ?? null;
}
