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

// --- G5-20: degenerate polygon under 3 dimensions ----------------------------------------
describe("RadarChart degenerate-shape guard (fewer than 3 dimensions)", () => {
  it("renders the labeled no-data placeholder for an empty set — not an invisible chart", () => {
    const { container } = render(<RadarChart dimensions={[]} />);
    expect(screen.getByRole("img", { name: /no dimension data/i })).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("with ONE dimension, shows the score as a bar rather than a single-vertex 'shape'", () => {
    // A 1-axis radar computes valid coordinates for exactly one point: zero area, nothing visible,
    // while the data plainly exists. The fallback must show the number, not hide it.
    render(<RadarChart dimensions={[dim("D1", "AI Tooling", 72)]} />);
    expect(screen.queryByRole("img", { name: /maturity radar/i })).not.toBeInTheDocument();
    expect(screen.getByText(/a radar needs three or more axes/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /AI Tooling: 72 of 100/i })).toBeInTheDocument();
    expect(screen.getByText("72")).toBeInTheDocument();
  });

  it("with TWO dimensions, shows both scores as bars rather than a zero-area line", () => {
    render(<RadarChart dimensions={[dim("D1", "AI Tooling", 72), dim("D2", "Testing", 41)]} />);
    expect(screen.queryByRole("img", { name: /maturity radar/i })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /AI Tooling: 72 of 100/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Testing: 41 of 100/i })).toBeInTheDocument();
  });

  it("at THREE dimensions the real radar takes over — the guard is exactly n < 3", () => {
    render(<RadarChart dimensions={DIMS} />);
    expect(screen.getByRole("img", { name: /maturity radar/i })).toBeInTheDocument();
    expect(screen.queryByText(/a radar needs three or more axes/i)).not.toBeInTheDocument();
  });

  it("the fallback keeps the picker reachable — each dimension is still a real button", () => {
    const onSelect = vi.fn();
    render(<RadarChart dimensions={[dim("D1", "AI Tooling", 72), dim("D2", "Testing", 41)]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Testing/ }));
    expect(onSelect).toHaveBeenCalledWith("D2");
  });

  it("a zero in the fallback renders an EMPTY track plus an explicit 'zero' line, not a hairline fill", () => {
    const { container } = render(<RadarChart dimensions={[dim("D1", "AI Tooling", 0), dim("D2", "Testing", 41)]} />);
    expect(screen.getByText(/zero: nothing detected/i)).toBeInTheDocument();
    // Exactly one filled bar (Testing's) — the zero contributes no fill div at all.
    const fills = Array.from(container.querySelectorAll<HTMLElement>("div[style*='width']"));
    expect(fills.map((f) => f.style.width)).toEqual(["41%"]);
  });
});

// --- G5-21: the 4% vertex floor -----------------------------------------------------------
describe("RadarChart zero-score vertices (no inflating floor)", () => {
  const CENTER = 170; // size 340 → cx = cy = 170

  it("plots a zero AT the centre — the polygon gains no area from an empty dimension", () => {
    // The old `Math.max(0.04, score/100)` put a 0 on a visible spoke, so the weakest dimensions —
    // the ones the chart most needs to be honest about — read as small positives.
    const { container } = render(
      <RadarChart dimensions={[dim("D1", "AI Tooling", 0), dim("D2", "Testing", 0), dim("D9", "Security", 88)]} />,
    );
    const poly = container.querySelector("polygon:not([fill='none'])")!;
    const pts = poly.getAttribute("points")!.split(" ").map((p) => p.split(",").map(Number));
    // Two of the three vertices are the exact centre (the zeros); none sits on a 4% spoke.
    const atCenter = pts.filter(([x, y]) => x === CENTER && y === CENTER);
    expect(atCenter).toHaveLength(2);
  });

  it("marks each zero with a hollow DASHED ring, so a 0 stays legible as a zero and not as a small score", () => {
    const { container } = render(
      <RadarChart dimensions={[dim("D1", "AI Tooling", 0), dim("D2", "Testing", 55), dim("D9", "Security", 88)]} />,
    );
    const zeros = Array.from(container.querySelectorAll("circle[data-zero]"));
    expect(zeros).toHaveLength(1);
    const ring = zeros[0]!;
    // Hollow (no fill) + dashed: an open, broken outline reads as an absence. A FILLED dot at any
    // radius would assert a measured magnitude, which is the bug.
    expect(ring.getAttribute("fill")).toBe("none");
    expect(ring.getAttribute("stroke-dasharray")).toBe("2 2");
    // …and it is parked slightly off centre so it is visible and hoverable rather than stacked on
    // the centre pixel with every other zero.
    expect(Number(ring.getAttribute("cy"))).toBeLessThan(CENTER);
  });

  it("non-zero vertices stay solid dots at their TRUE radius (no floor applied to them either)", () => {
    const { container } = render(
      <RadarChart dimensions={[dim("D1", "AI Tooling", 2), dim("D2", "Testing", 55), dim("D9", "Security", 88)]} />,
    );
    expect(container.querySelectorAll("circle[data-zero]")).toHaveLength(0);
    // D1 at 2/100 sits at 2% of the radius — barely off centre, which is the truth.
    const poly = container.querySelector("polygon:not([fill='none'])")!;
    const first = poly.getAttribute("points")!.split(" ")[0]!.split(",").map(Number);
    const radius = 340 / 2 - 56;
    expect(first[1]!).toBeCloseTo(CENTER - radius * 0.02, 1);
  });

  it("explains the zero mark in a legend and in the SVG description — shape alone is not an encoding", () => {
    render(<RadarChart dimensions={[dim("D1", "AI Tooling", 0), dim("D2", "Testing", 55), dim("D9", "Security", 88)]} />);
    expect(screen.getByText(/dashed ring = scored 0/i)).toBeInTheDocument();
    expect(screen.getByText(/hollow dashed ring rather than a plotted vertex/i)).toBeInTheDocument();
  });

  it("shows no zero legend when nothing scored zero", () => {
    render(<RadarChart dimensions={DIMS} />);
    expect(screen.queryByText(/dashed ring = scored 0/i)).not.toBeInTheDocument();
  });

  it("an ALL-ZERO radar collapses the polygon to the centre and rings every axis", () => {
    const { container } = render(
      <RadarChart dimensions={[dim("D1", "A", 0), dim("D2", "B", 0), dim("D9", "C", 0)]} />,
    );
    const poly = container.querySelector("polygon:not([fill='none'])")!;
    expect(poly.getAttribute("points")).toBe(`${CENTER}.0,${CENTER}.0 ${CENTER}.0,${CENTER}.0 ${CENTER}.0,${CENTER}.0`);
    expect(container.querySelectorAll("circle[data-zero]")).toHaveLength(3);
    // The sr table still reports three honest zeros.
    expect(screen.getAllByRole("cell", { name: "0" })).toHaveLength(3);
  });
});
