// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DimensionResult } from "@/lib/types";
import { RadarChart } from "./RadarChart";

// A DimensionResult carries far more than the chart reads; build the minimal shape the radar uses
// (id/name/score) and stub the rest so the fixture stays honest to the type without noise.
function dim(id: DimensionResult["id"], name: string, score: number): DimensionResult {
  return { id, name, score, weight: 1, signalScore: score, llmScore: score, summary: "", evidence: [], strengths: [], gaps: [] };
}

const DIMS: DimensionResult[] = [
  dim("D1", "AI Tooling", 72),
  dim("D2", "Testing", 41),
  dim("D9", "Security", 88),
];

describe("RadarChart accessibility", () => {
  it("exposes a screen-reader table equivalent of the radar — a row per dimension with score + level", () => {
    render(<RadarChart dimensions={DIMS} />);

    // The opaque SVG is role=img with a real accessible name (title + desc via aria-labelledby),
    // not an unlabelled graphic.
    expect(screen.getByRole("img", { name: /maturity radar/i })).toBeInTheDocument();

    // The sr-only <table> is the non-visual equivalent: 3 column headers + one row per dimension.
    const table = screen.getByRole("table", { name: /maturity score by dimension/i });
    expect(table).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    // 1 header row + 3 data rows.
    expect(screen.getAllByRole("row")).toHaveLength(4);
    // Each dimension is a row header (scope="row") and its numeric score is present in the a11y tree.
    for (const d of DIMS) {
      expect(screen.getByRole("rowheader", { name: d.name })).toBeInTheDocument();
      // Score text appears both in the sr-only cell and the SVG numeral — assert it is announced at all.
      expect(screen.getAllByText(String(d.score)).length).toBeGreaterThan(0);
    }
  });

  it("renders the per-dimension numerals at slate-400, not the AA-failing slate-500 (contrast lock)", () => {
    // Regression pin for the ~3.9:1 slate-500 numerals: the default (non-highlighted) numeral tspans
    // must stay fill-slate-400 (~4.6:1). No highlightId here, so EVERY numeral is in the default state.
    const { container } = render(<RadarChart dimensions={DIMS} />);
    const tspans = Array.from(container.querySelectorAll("tspan"));
    expect(tspans).toHaveLength(DIMS.length);
    for (const t of tspans) {
      const cls = t.getAttribute("class") ?? "";
      expect(cls).toContain("fill-slate-400");
      expect(cls).not.toContain("fill-slate-500");
    }
  });
});
