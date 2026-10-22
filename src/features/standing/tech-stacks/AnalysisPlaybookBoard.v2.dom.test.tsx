// @vitest-environment jsdom
//
// The Prism playbook board states the same coverage as the Altimeter one: what each verdict rests on reaches
// the DOM on the row and in the expanded playbook, and a minority read is de-weighted, not hidden.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { AnalysisPlaybookBoardV2 } from "./AnalysisPlaybookBoard.v2";
import { STACK_SCOPE } from "./analysisScope";
import type { DimInsight } from "./fleetAnalysis";

const dim = (over: Partial<DimInsight>): DimInsight => ({
  dimId: "D2",
  label: "Testing",
  min: 20,
  max: 96,
  mean: 58,
  spread: 76,
  fleet: 55,
  leader: { id: "be", name: "Backend · Rust", value: 96 },
  laggard: { id: "lib", name: "Library", value: 20 },
  klass: "divergent",
  count: 8,
  scoredCount: 8,
  ...over,
});

const board = (dims: DimInsight[]) =>
  render(<AnalysisPlaybookBoardV2 org="acme" dims={dims} scope={STACK_SCOPE} />);

describe("AnalysisPlaybookBoardV2 coverage", () => {
  it("states what each verdict rests on, on the diagnosis row", () => {
    // A "consistent" row is not actionable, so it renders its diagnosis row only — exactly one chip.
    board([
      dim({ dimId: "D3", label: "Docs", klass: "consistent", min: 50, max: 60, spread: 10, count: 8, scoredCount: 8 }),
      dim({ dimId: "D9", label: "Security", klass: "consistent", min: 50, max: 60, spread: 10, count: 3, scoredCount: 8 }),
    ]);
    expect(screen.getByText("8/8 stacks")).toBeTruthy();
    expect(screen.getByText(/^3\/8 stacks/)).toBeTruthy();
  });

  it("de-weights a low-coverage verdict without hiding it", () => {
    board([dim({ dimId: "D3", label: "Docs", klass: "consistent", min: 50, max: 60, spread: 10, count: 2, scoredCount: 8 })]);
    // The verdict still renders in full…
    expect(screen.getByText("Consistent")).toBeTruthy();
    expect(screen.getByText("Docs")).toBeTruthy();
    // …it is just labelled as the minority read it is.
    expect(screen.getByText(/2\/8 stacks · low coverage/)).toBeTruthy();
  });

  it("does not call a unanimous verdict low-coverage", () => {
    board([dim({})]);
    expect(screen.queryByText(/low coverage/)).toBeNull();
  });

  it("carries the coverage into the expanded playbook, where the recommendation is read", () => {
    // The first actionable (divergent) row auto-expands, so the playbook detail is in the DOM: the
    // chip appears on BOTH the diagnosis row and the plan, plus the plain-language caveat.
    board([dim({ count: 2, scoredCount: 8 })]);
    expect(screen.getAllByText(/2\/8 stacks/)).toHaveLength(2);
    expect(screen.getByText(/inferred from 2 of 8 scored stacks, not the whole fleet/)).toBeTruthy();
  });
});
