// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

describe("RadarChart picker reach (keyboard + touch)", () => {
  it("with onSelect, every dimension row exposes a real button that fires the selection", () => {
    // The SVG pick path is pointer-geometry only; keyboard/SR users select via the sr-only table's
    // per-dimension buttons (the DimLine sr-only link-list pattern).
    const onSelect = vi.fn();
    render(<RadarChart dimensions={DIMS} onSelect={onSelect} />);
    for (const d of DIMS) {
      const btn = screen.getByRole("button", { name: d.name });
      fireEvent.click(btn);
      expect(onSelect).toHaveBeenLastCalledWith(d.id);
    }
    expect(onSelect).toHaveBeenCalledTimes(DIMS.length);
  });

  it("without onSelect, the table stays static — no buttons", () => {
    render(<RadarChart dimensions={DIMS} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("a stationary tap (pointerdown, no pointermove) resolves the vertex so click selects it", () => {
    // Back-ported onPointerDown snap: previously `active` was only set by pointermove, so a touch
    // tap clicked with active === null and the pick silently no-oped.
    const onSelect = vi.fn();
    const { container } = render(<RadarChart dimensions={DIMS} onSelect={onSelect} size={340} />);
    const svg = container.querySelector("svg")!;
    // jsdom has no layout — give the svg a concrete box so the pointer→viewBox math works.
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 436, height: 340, right: 436, bottom: 340, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    // D1's vertex sits straight up from center at frac 72/100: center (170,170), radius 114 →
    // viewBox (170, 87.92); client x = viewBox x + labelPadX(48) = 218, y = 88 (1:1 box).
    // Tap it: pointerdown then click, NO pointermove.
    fireEvent.pointerDown(svg, { clientX: 218, clientY: 88 });
    fireEvent.click(svg);
    expect(onSelect).toHaveBeenCalledWith("D1");
  });
});
