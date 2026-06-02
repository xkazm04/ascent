// Regression tests for the assessment-validation honesty fix (scan-and-decide idea 3f8ac320):
// a dimension that arrives without a real numeric score must be SKIPPED, not coerced to 0, so
// the isAssessmentUsable coverage gate can't be fooled by a model that returns ids but no scores.

import { describe, it, expect } from "vitest";
import { validateAssessment, isAssessmentUsable } from "./provider";

describe("validateAssessment — score coercion (#1)", () => {
  it("keeps a genuine 0 score", () => {
    const a = validateAssessment({ dimensions: [{ id: "D1", score: 0 }] });
    expect(a.dimensions).toHaveLength(1);
    expect(a.dimensions[0]).toMatchObject({ id: "D1", score: 0 });
  });

  it("skips a dimension whose score field is missing (was silently coerced to 0)", () => {
    const a = validateAssessment({ dimensions: [{ id: "D1", summary: "no score here" }] });
    expect(a.dimensions).toHaveLength(0);
  });

  it("skips a dimension with a non-numeric score", () => {
    expect(validateAssessment({ dimensions: [{ id: "D2", score: "n/a" }] }).dimensions).toHaveLength(0);
    expect(validateAssessment({ dimensions: [{ id: "D2", score: null }] }).dimensions).toHaveLength(0);
    expect(validateAssessment({ dimensions: [{ id: "D2", score: "" }] }).dimensions).toHaveLength(0);
  });

  it("accepts a numeric string score", () => {
    expect(validateAssessment({ dimensions: [{ id: "D3", score: "75" }] }).dimensions[0]).toMatchObject({
      id: "D3",
      score: 75,
    });
  });

  it("clamps an out-of-range numeric score", () => {
    expect(validateAssessment({ dimensions: [{ id: "D1", score: 250 }] }).dimensions[0].score).toBe(100);
    expect(validateAssessment({ dimensions: [{ id: "D1", score: -5 }] }).dimensions[0].score).toBe(0);
  });

  it("still drops unknown dimension ids", () => {
    expect(validateAssessment({ dimensions: [{ id: "D99", score: 50 }] }).dimensions).toHaveLength(0);
  });
});

describe("isAssessmentUsable — coverage gate honesty (#1)", () => {
  it("rejects an all-missing-score reply that previously slipped through as zeros", () => {
    // 9 valid ids, every one missing its score. Before the fix each became a real 0 and counted
    // toward coverage, so this passed the gate and rendered the deterministic floor as 'AI'.
    const raw = { dimensions: Array.from({ length: 9 }, (_, i) => ({ id: `D${i + 1}` })) };
    const a = validateAssessment(raw);
    expect(a.dimensions).toHaveLength(0);
    expect(isAssessmentUsable(a, 9)).toBe(false);
  });

  it("accepts a reply that scores at least half the requested dimensions", () => {
    const raw = { dimensions: Array.from({ length: 9 }, (_, i) => ({ id: `D${i + 1}`, score: 60 })) };
    const a = validateAssessment(raw);
    expect(a.dimensions).toHaveLength(9);
    expect(isAssessmentUsable(a, 9)).toBe(true);
  });

  it("treats genuine zeros as real coverage", () => {
    const raw = { dimensions: Array.from({ length: 9 }, (_, i) => ({ id: `D${i + 1}`, score: 0 })) };
    expect(isAssessmentUsable(validateAssessment(raw), 9)).toBe(true);
  });
});
