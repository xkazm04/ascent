// @vitest-environment jsdom
//
// The correctness bug this pins, found in the /org UX redesign wave 2 (2026-09-08):
//
// every heatmap cell read `byId[d] ?? 0`, so a repository whose latest scan never scored a dimension
// was painted as a RED ZERO, announced to a screen reader as "score 0", and given a click target
// that opened a detail modal for a measurement that does not exist. It was a fabricated finding —
// and the same component contradicted it two rows down, where `columnAverages` has always EXCLUDED
// those repos from the fleet mean rather than dragging it toward zero. One component, two answers.
//
// A seeded absence is pinned in every one of these cases so the fix cannot quietly stop biting.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { RepoDimensionHeatmap, type HeatRow } from "@/features/standing/overview/RepoDimensionHeatmap";

const DIMS = ["D1", "D2", "D3"];

/** `full` carries every dimension; `legacy` never scored D2 — the absence under test. */
const ROWS: HeatRow[] = [
  { name: "api", fullName: "acme/api", dims: [{ dimId: "D1", score: 80 }, { dimId: "D2", score: 40 }, { dimId: "D3", score: 60 }] },
  { name: "legacy", fullName: "acme/legacy", dims: [{ dimId: "D1", score: 70 }, { dimId: "D3", score: 50 }] },
];

const grid = (rows: HeatRow[] = ROWS, dims: string[] = DIMS) =>
  render(<RepoDimensionHeatmap org="acme" rows={rows} dims={dims} />).container;

describe("RepoDimensionHeatmap — an absent measurement is a void, not a zero", () => {
  it("never announces a score of 0 for a dimension the repo does not carry", () => {
    grid();
    expect(screen.queryByLabelText(/legacy D2 score 0/)).toBeNull();
    expect(screen.queryByLabelText(/score 0, open detail/)).toBeNull();
  });

  it("renders the absence as the kit's missing mark, with the shared caveat", () => {
    grid();
    const cell = screen.getByLabelText("legacy D2: no measurement");
    expect(cell).toBeInTheDocument();
    expect(cell.getAttribute("title")).toContain("No measurement");
    expect(cell.getAttribute("title")).toContain("never a zero");
  });

  it("gives the void no click target — there is no detail to open", () => {
    grid();
    expect(screen.getByLabelText("legacy D2: no measurement").tagName.toLowerCase()).not.toBe("button");
    // The two repos carry five real scores between them; only those are buttons.
    expect(screen.getAllByRole("button").filter((b) => /open detail/.test(b.getAttribute("aria-label") ?? ""))).toHaveLength(5);
  });

  it("still opens a real cell for every measurement that exists", () => {
    grid();
    expect(screen.getByLabelText("api D2 score 40, open detail")).toBeInTheDocument();
  });

  it("voids the fleet average of a column no repo scored", () => {
    const rows: HeatRow[] = [{ name: "legacy", fullName: "acme/legacy", dims: [{ dimId: "D1", score: 70 }] }];
    grid(rows);
    expect(screen.getByLabelText("No fleet average for D2")).toBeInTheDocument();
    // The column mean has never counted the absence as a zero; the footer now says so in the same
    // vocabulary the body cell does, instead of an em dash.
    expect(screen.getByTitle("Fleet average for D1: 70")).toBeInTheDocument();
  });

  it("teaches the encoding only when the grid actually contains one", () => {
    expect(grid().textContent).toContain("No measurement");
    const complete: HeatRow[] = [
      { name: "api", fullName: "acme/api", dims: DIMS.map((dimId) => ({ dimId, score: 70 })) },
    ];
    expect(grid(complete).textContent).not.toContain("No measurement");
  });

  it("keeps the header a noun phrase with the scope only", () => {
    const c = grid();
    expect(c.textContent).toContain("2 repos × 3 dimensions");
    expect(c.textContent).not.toContain("Where each repo is strong or weak");
  });
});
