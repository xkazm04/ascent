// Model-quality scorecard types + pure ranking helpers for the ONE ascent LLM op (repo-maturity
// assess). The measured data (scripts/matrix/run.mts → bake.mts) is baked into ./matrix-scores.data;
// this module is pure + client-safe (no data, no I/O) so the org settings scorecard can rank models on
// evidence: judged output quality, CALIBRATION accuracy against the labeled bench (does the model land
// the right maturity level), reliability, and speed. See docs/features/scanning/llm-model-matrix.md.

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

// ---------------------------------------------------------------------------
// Reading the matrix honestly: adapter artifacts + staleness
// ---------------------------------------------------------------------------

/**
 * The output-token ceiling the bench ran each model under — the default of the adapters'
 * OPENROUTER_MAX_TOKENS / OPENAI_MAX_TOKENS knob (llmMaxTokens' fallback). Mirrored as a literal
 * rather than imported so this module stays pure and client-safe (no process.env reads).
 */
export const MATRIX_OUTPUT_TOKEN_CAP = 4096;

/** At/above this share of the cap, the model's mean output is "pinned" — i.e. it was cut off. */
const CAP_PINNED_RATIO = 0.99;
/** Reliability at or below this is a total failure to produce the shape, not a quality gradient. */
const ARTIFACT_RELIABILITY_MAX = 0.05;

/**
 * Is this row a DECODE-ADAPTER artifact rather than a model verdict?
 *
 * A model that scored zero because its every attempt ran into the output cap didn't "fail the
 * assessment" — the harness truncated it (docs/features/scanning/llm-model-matrix.md). Rendering that as
 * "claude-sonnet-5 · 0.0 · ⚠ 0%" discredits the scorecard, not the model, in front of the enterprise
 * buyer using it to choose. Detected structurally (near-zero reliability AND mean output pinned at the
 * cap) so the rule keeps working after a re-bake — never a hardcoded model name.
 */
export function isAdapterArtifact(m: ModelScore): boolean {
  return m.reliability <= ARTIFACT_RELIABILITY_MAX && m.outTok >= MATRIX_OUTPUT_TOKEN_CAP * CAP_PINNED_RATIO;
}

/** The label to render in place of an artifact row's scores. */
export const ADAPTER_ARTIFACT_LABEL = "adapter limit — not a model verdict";

/** Models measured on their merits (artifacts excluded) — the rows that carry a real verdict. */
export function scoredModels(scores: MatrixScores): ModelScore[] {
  return rankModels(scores).filter((m) => !isAdapterArtifact(m));
}

/** Beyond this age the baked matrix is a historical record, not a current recommendation. */
export const MATRIX_STALE_AFTER_DAYS = 45;
const DAY_MS = 86_400_000;

/**
 * Age of the baked run in whole days at `now` (epoch ms, passed IN so callers/tests control the
 * clock — never read from Date.now() here). NaN for an unparseable timestamp.
 */
export function matrixAgeDays(scores: Pick<MatrixScores, "measuredAt">, now: number): number {
  const measured = Date.parse(scores.measuredAt);
  if (!Number.isFinite(measured)) return NaN;
  return Math.floor((now - measured) / DAY_MS);
}

/**
 * Should the scorecard warn that this run is old? A 6-month-old matrix otherwise reads identically to
 * a fresh one, and model lineups turn over far faster than that.
 */
export function isMatrixStale(scores: Pick<MatrixScores, "measuredAt">, now: number): boolean {
  const age = matrixAgeDays(scores, now);
  return Number.isFinite(age) && age > MATRIX_STALE_AFTER_DAYS;
}
