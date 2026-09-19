// First tests for the model-matrix ranking math and the two "read this honestly" predicates:
// the DECODE-ADAPTER artifact detector (a row that scored zero because the harness truncated it is
// not a model verdict) and the staleness threshold. Pure module — no data, no I/O.

import { describe, expect, it } from "vitest";
import {
  ADAPTER_ARTIFACT_LABEL,
  bestModel,
  calibrationScore,
  isAdapterArtifact,
  isMatrixStale,
  matrixAgeDays,
  MATRIX_OUTPUT_TOKEN_CAP,
  MATRIX_STALE_AFTER_DAYS,
  overallScore,
  rankModels,
  scoredModels,
  type MatrixScores,
  type ModelScore,
} from "./matrix-scores";

function model(over: Partial<ModelScore> = {}): ModelScore {
  return {
    model: "vendor/model",
    quality: 7,
    relevance: 7,
    correctness: 7,
    adherence: 7,
    exact: 0.8,
    within1: 1,
    mae: 0.2,
    reliability: 1,
    p50Ms: 20_000,
    outTok: 2000,
    n: 10,
    ...over,
  };
}

function scores(models: ModelScore[], measuredAt = "2026-07-07T13:27:49.460Z"): MatrixScores {
  return { measuredAt, judge: "anthropic/claude-sonnet-5", repos: 10, models };
}

describe("ranking math", () => {
  it("turns level MAE into a 0–10 calibration score", () => {
    expect(calibrationScore({ mae: 0 })).toBe(10);
    expect(calibrationScore({ mae: 1 })).toBe(7);
    expect(calibrationScore({ mae: 2 })).toBe(4);
    expect(calibrationScore({ mae: 9 })).toBe(0); // clamped, never negative
  });

  it("blends 60% quality + 40% calibration and scales by reliability", () => {
    const perfect = model({ quality: 10, mae: 0, reliability: 1 });
    expect(overallScore(perfect)).toBe(10);
    // Same model at half reliability scores half — a model that often fails can't top the board.
    expect(overallScore(model({ quality: 10, mae: 0, reliability: 0.5 }))).toBe(5);
  });

  it("ranks best-first without mutating the input order", () => {
    const weak = model({ model: "a/weak", quality: 3 });
    const strong = model({ model: "a/strong", quality: 9 });
    const s = scores([weak, strong]);
    expect(rankModels(s).map((m) => m.model)).toEqual(["a/strong", "a/weak"]);
    expect(s.models.map((m) => m.model)).toEqual(["a/weak", "a/strong"]); // untouched
  });

  it("bestModel is null when nothing was measured", () => {
    expect(bestModel(scores([]))).toBeNull();
  });
});

describe("adapter-artifact predicate", () => {
  it("flags a row that scored nothing with output pinned at the cap", () => {
    // The baked claude-sonnet-5 row: reliability 0, outTok exactly at the 4096 cap.
    expect(isAdapterArtifact(model({ reliability: 0, outTok: MATRIX_OUTPUT_TOKEN_CAP }))).toBe(true);
  });

  it("does NOT flag a genuinely unreliable model that stayed under the cap", () => {
    // deepseek-v4-flash (0.4 / 4008) and glm-5.2 (0.3 / 3715): real reliability findings, not artifacts.
    expect(isAdapterArtifact(model({ reliability: 0.4, outTok: 4008 }))).toBe(false);
    expect(isAdapterArtifact(model({ reliability: 0.3, outTok: 3715 }))).toBe(false);
  });

  it("does NOT flag a model that merely writes long answers reliably", () => {
    expect(isAdapterArtifact(model({ reliability: 1, outTok: MATRIX_OUTPUT_TOKEN_CAP }))).toBe(false);
  });

  it("needs BOTH conditions — a zero-reliability model with short output is a real failure", () => {
    expect(isAdapterArtifact(model({ reliability: 0, outTok: 300 }))).toBe(false);
  });

  it("scoredModels drops artifacts and keeps the real verdicts ranked", () => {
    const artifact = model({ model: "a/artifact", quality: 0, mae: 0, reliability: 0, outTok: MATRIX_OUTPUT_TOKEN_CAP });
    const real = model({ model: "a/real", quality: 8 });
    expect(scoredModels(scores([artifact, real])).map((m) => m.model)).toEqual(["a/real"]);
  });

  it("exports a label the UI and tests share", () => {
    expect(ADAPTER_ARTIFACT_LABEL).toMatch(/not a model verdict/i);
  });
});

describe("staleness", () => {
  const measuredAt = "2026-01-01T00:00:00.000Z";
  const at = (days: number) => Date.parse(measuredAt) + days * 86_400_000;

  it("reports whole days of age against an injected clock", () => {
    expect(matrixAgeDays({ measuredAt }, at(0))).toBe(0);
    expect(matrixAgeDays({ measuredAt }, at(10.5))).toBe(10);
  });

  it("goes stale strictly AFTER the threshold", () => {
    expect(isMatrixStale({ measuredAt }, at(MATRIX_STALE_AFTER_DAYS))).toBe(false);
    expect(isMatrixStale({ measuredAt }, at(MATRIX_STALE_AFTER_DAYS + 1))).toBe(true);
    expect(isMatrixStale({ measuredAt }, at(180))).toBe(true);
  });

  it("never warns on an unparseable timestamp", () => {
    expect(Number.isNaN(matrixAgeDays({ measuredAt: "not-a-date" }, Date.now()))).toBe(true);
    expect(isMatrixStale({ measuredAt: "not-a-date" }, Date.now())).toBe(false);
  });
});
