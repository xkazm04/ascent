// The legend's rows, derived from what the chart paints rather than kept beside it in a whitelist.
//
// The acceptance cases of design-system-primitives#A (challenge-2026-09-23b). Each matrix case would
// have been wrong under the bespoke helpers it replaces: they read `r.cells` (never the void padding
// MatrixGrid draws for a short row) and filtered through a private ["measured","not-judged"] list.

import { describe, expect, it } from "vitest";
import { ladderLegendStates, matrixLegendStates, vizStatesInOrder } from "./legendStates";
import { VIZ_STATES } from "./states";
import type { LadderBand } from "./BandLadder";
import type { MatrixRow } from "./matrixShared";

const AXES = ["Declared", "Observed", "Enforced"];

describe("matrixLegendStates", () => {
  it("counts the void padding MatrixGrid paints for a short row", () => {
    const rows: MatrixRow[] = [{ id: "c", label: "acme/cli", cells: [{ state: "measured", score: 10 }] }];
    expect(matrixLegendStates(AXES, rows)).toEqual(["measured", "missing"]);
  });

  it("returns the vocabulary's order, whatever order the cells arrive in, with no whitelist", () => {
    const rows: MatrixRow[] = [
      { id: "a", label: "acme/api", cells: [{ state: "not-judged" }, { state: "declared", score: 40 }, { state: "measured", score: 70 }] },
    ];
    expect(matrixLegendStates(AXES, rows)).toEqual(["measured", "declared", "not-judged"]);
  });

  it("ignores a cell past the last axis, which MatrixGrid never draws", () => {
    const rows: MatrixRow[] = [{ id: "a", label: "a", cells: [{ state: "measured" }, { state: "superseded" }] }];
    expect(matrixLegendStates(["Only"], rows)).toEqual(["measured"]);
  });

  it("is empty where MatrixGrid draws its placeholder (no axes or no rows)", () => {
    expect(matrixLegendStates([], [{ id: "a", label: "a", cells: [{ state: "measured" }] }])).toEqual([]);
    expect(matrixLegendStates(AXES, [])).toEqual([]);
  });
});

describe("ladderLegendStates", () => {
  const T0: LadderBand = { id: "t0", label: "T0", state: "measured" };

  it("counts a state-less edge as the `missing` crossing BandLadder paints", () => {
    expect(ladderLegendStates([T0], { label: "unstated", count: 2 })).toEqual(["measured", "missing"]);
  });

  it("keeps a declared band (no private whitelist drops it)", () => {
    const bands: LadderBand[] = [T0, { id: "t1", label: "T1", state: "declared" }];
    expect(ladderLegendStates(bands, null)).toContain("declared");
    expect(ladderLegendStates(bands, null)).toEqual(["measured", "declared"]);
  });

  it("adds nothing for an absent edge, and honours an edge's own state", () => {
    expect(ladderLegendStates([T0], null)).toEqual(["measured"]);
    expect(ladderLegendStates([T0], undefined)).toEqual(["measured"]);
    expect(ladderLegendStates([T0], { label: "x", state: "not-judged" })).toEqual(["measured", "not-judged"]);
  });

  it("is empty where BandLadder draws its placeholder (no bands), even with an edge", () => {
    expect(ladderLegendStates([], { label: "x" })).toEqual([]);
  });
});

describe("vizStatesInOrder", () => {
  it("de-duplicates into VIZ_STATES order", () => {
    expect(vizStatesInOrder(["superseded", "missing", "measured", "missing"])).toEqual(["measured", "missing", "superseded"]);
    expect(vizStatesInOrder([...VIZ_STATES].reverse())).toEqual([...VIZ_STATES]);
    expect(vizStatesInOrder([])).toEqual([]);
  });
});
