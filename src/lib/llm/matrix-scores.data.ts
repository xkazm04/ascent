// Measured model-quality scores for the repo-maturity assess op — output of the Python-free bench
// matrix (scripts/matrix/run.mts), judged by an LLM, baked by scripts/matrix/bake.mts. GENERATED —
// re-bake, don't hand-edit. See docs/features/scanning/llm-model-matrix.md.
// Baked from a run at 2026-07-07T13:27:49.460Z.
import type { MatrixScores } from "@/lib/llm/matrix-scores";

export const MATRIX_SCORES: MatrixScores = {
  "measuredAt": "2026-07-07T13:27:49.460Z",
  "judge": "anthropic/claude-sonnet-5",
  "repos": 10,
  "models": [
    {
      "model": "openai/gpt-4o-mini",
      "quality": 4.9,
      "relevance": 5.9,
      "correctness": 4.7,
      "adherence": 6.3,
      "exact": 0.8,
      "within1": 1,
      "mae": 0.2,
      "reliability": 1,
      "p50Ms": 21552,
      "outTok": 1544,
      "n": 10
    },
    {
      "model": "openai/gpt-5.4-mini",
      "quality": 6.7,
      "relevance": 7.8,
      "correctness": 6.6,
      "adherence": 7.2,
      "exact": 0.8,
      "within1": 1,
      "mae": 0.2,
      "reliability": 1,
      "p50Ms": 22532,
      "outTok": 2848,
      "n": 10
    },
    {
      "model": "google/gemini-3.5-flash",
      "quality": 6.9,
      "relevance": 7.8,
      "correctness": 6.5,
      "adherence": 8.4,
      "exact": 0.8,
      "within1": 1,
      "mae": 0.2,
      "reliability": 1,
      "p50Ms": 15455,
      "outTok": 2552,
      "n": 10
    },
    {
      "model": "deepseek/deepseek-v4-flash",
      "quality": 6.5,
      "relevance": 6.3,
      "correctness": 6,
      "adherence": 7.8,
      "exact": 0.5,
      "within1": 1,
      "mae": 0.5,
      "reliability": 0.4,
      "p50Ms": 45405,
      "outTok": 4008,
      "n": 10
    },
    {
      "model": "z-ai/glm-5.2",
      "quality": 7,
      "relevance": 8.3,
      "correctness": 6.3,
      "adherence": 8,
      "exact": 1,
      "within1": 1,
      "mae": 0,
      "reliability": 0.3,
      "p50Ms": 76762,
      "outTok": 3715,
      "n": 10
    },
    {
      "model": "anthropic/claude-sonnet-5",
      "quality": 0,
      "relevance": 0,
      "correctness": 0,
      "adherence": 0,
      "exact": 0,
      "within1": 0,
      "mae": 0,
      "reliability": 0,
      "p50Ms": 45283,
      "outTok": 4096,
      "n": 10
    }
  ]
};

/** True once a matrix run has been baked in (so the UI can hide the scorecard before any run). */
export function hasMatrixScores(): boolean {
  return MATRIX_SCORES.models.length > 0;
}
