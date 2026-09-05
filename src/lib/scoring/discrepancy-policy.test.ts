// First direct tests for the discrepancy BUDGET — the rule that removes the PAYOFF of getting an extra
// discrepancy emitted. It matters because a `discrepancies` entry doubles that dimension's guardband
// (±25 → ±50) with no corroboration, and the claim travels through a prompt that quotes repo-authored
// file content: without a budget, a repository has a channel into how far the model may move the number
// about that same repository. engine.test.ts asserted only that MAX_FLAGGED_DIMENSIONS === 2 — the
// constant, never the behavior it governs.
//
// The load-bearing property is ALL-OR-NOTHING. Any "keep the first N" rule needs a tie-break the model
// can steer (ordering), and a partially-honoured blanket claim is the worst of both.

import { describe, it, expect } from "vitest";
import { applyDiscrepancyBudget, MAX_FLAGGED_DIMENSIONS } from "./discrepancy-policy";

describe("applyDiscrepancyBudget — within budget", () => {
  it("widens nothing, and is not capped, for an empty audit", () => {
    const r = applyDiscrepancyBudget<string>([]);
    expect(r.widened.size).toBe(0);
    expect(r.capped).toBe(false);
    expect(r.flaggedCount).toBe(0);
  });

  it("widens a single flagged dimension", () => {
    const r = applyDiscrepancyBudget(["D2"]);
    expect([...r.widened]).toEqual(["D2"]);
    expect(r.capped).toBe(false);
  });

  it("widens EXACTLY at the budget — the cap is >, not >=", () => {
    const at = Array.from({ length: MAX_FLAGGED_DIMENSIONS }, (_, i) => `D${i + 1}`);
    const r = applyDiscrepancyBudget(at);
    expect(r.widened.size).toBe(MAX_FLAGGED_DIMENSIONS);
    expect(r.capped).toBe(false);
    expect(r.flaggedCount).toBe(MAX_FLAGGED_DIMENSIONS);
  });
});

describe("applyDiscrepancyBudget — over budget blows to zero", () => {
  const over = Array.from({ length: MAX_FLAGGED_DIMENSIONS + 1 }, (_, i) => `D${i + 1}`);

  it("widens NOTHING when more than the budget is flagged", () => {
    const r = applyDiscrepancyBudget(over);
    expect(r.widened.size).toBe(0);
    expect(r.capped).toBe(true);
  });

  it("is all-or-nothing, NOT keep-the-first-N — order can't buy a partial win", () => {
    // The security property: if the rule kept the first N, a model (or planted text) could steer which
    // dimensions survive purely by emitting them first.
    const forward = applyDiscrepancyBudget(over);
    const reversed = applyDiscrepancyBudget([...over].reverse());
    expect(forward.widened.size).toBe(0);
    expect(reversed.widened.size).toBe(0);
    expect([...forward.widened]).toEqual([...reversed.widened]);
  });

  it("reports how many were flagged, so the capped warning can say it", () => {
    expect(applyDiscrepancyBudget(over).flaggedCount).toBe(MAX_FLAGGED_DIMENSIONS + 1);
    expect(applyDiscrepancyBudget(["D1", "D2", "D3", "D4", "D5"]).flaggedCount).toBe(5);
  });
});

describe("applyDiscrepancyBudget — counts DISTINCT dimensions", () => {
  it("de-duplicates, so repeating one dimension can't exhaust the budget", () => {
    // A model that flags D2 three times has made ONE claim about ONE dimension. Counting the repeats
    // would blow the budget and suppress its own (single, possibly correct) finding.
    const r = applyDiscrepancyBudget(["D2", "D2", "D2"]);
    expect([...r.widened]).toEqual(["D2"]);
    expect(r.capped).toBe(false);
    expect(r.flaggedCount).toBe(1);
  });

  it("de-duplication is what decides the cap, not the raw claim count", () => {
    const r = applyDiscrepancyBudget(["D1", "D1", "D2", "D2"]);
    expect(r.capped).toBe(false);
    expect(r.widened.size).toBe(2);
  });
});

describe("MAX_FLAGGED_DIMENSIONS", () => {
  it("is small enough that the budget is a real constraint on a 9-dimension rubric", () => {
    // Pinned as a property rather than a literal: the point is that a scan can widen only a small
    // minority of the rubric. The prompt quotes this same constant, so the two cannot disagree.
    expect(MAX_FLAGGED_DIMENSIONS).toBeGreaterThan(0);
    expect(MAX_FLAGGED_DIMENSIONS).toBeLessThan(9 / 2);
  });
});
