// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConcentrationCurve } from "./ConcentrationCurve";
import { concentrationOf } from "./lorenz";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

// Four contributors at 1 and one at 6: half the work sits with one person.
const SKEWED = [1, 1, 6, 1, 1];

describe("concentrationOf (the maths behind the curve)", () => {
  it("computes the Lorenz points, the Gini and the bus factor from one sorted pass", () => {
    const c = concentrationOf(SKEWED)!;
    expect(c.n).toBe(5);
    expect(c.total).toBe(10);
    expect(c.gini).toBeCloseTo(0.4, 5);
    expect(c.busFactor).toBe(1);
    expect(c.points[0]).toEqual({ x: 0, y: 0 });
    expect(c.points[c.points.length - 1]).toEqual({ x: 1, y: 1 });
    // The knee is the largest sag below equality: 80% of people hold 40% of the work.
    expect(c.knee.x).toBeCloseTo(0.8, 5);
    expect(c.knee.y).toBeCloseTo(0.4, 5);
  });

  it("returns null rather than a straight line when the data cannot carry the claim", () => {
    expect(concentrationOf([])).toBeNull();
    expect(concentrationOf([5])).toBeNull();
    expect(concentrationOf([0, 0, 0])).toBeNull();
  });

  it("drops non-finite and negative magnitudes instead of zeroing them", () => {
    const c = concentrationOf([1, Number.NaN, 3, -2, Number.POSITIVE_INFINITY])!;
    expect(c.n).toBe(2);
    expect(c.total).toBe(4);
  });

  it("reports an even split as a Gini of ~0 with the majority bus factor", () => {
    const c = concentrationOf([5, 5, 5, 5])!;
    expect(c.gini).toBeCloseTo(0, 5);
    expect(c.busFactor).toBe(2);
  });
});

describe("ConcentrationCurve accessibility", () => {
  it("states the concentration reading in its accessible name", () => {
    render(<ConcentrationCurve values={SKEWED} subjectLabel="contributors" valueLabel="commits" title="Concentration" />);
    const name = screen.getByRole("img", { name: /Concentration/i }).getAttribute("aria-label")!;
    expect(name).toContain("5 contributors");
    expect(name).toContain("Gini 0.40");
    expect(name).toContain("The top 20% of contributors produce 60% of commits");
    expect(name).toContain("Bus factor 1");
  });

  it("renders an sr-only table of cumulative shares plus the two summary rows", () => {
    render(<ConcentrationCurve values={SKEWED} title="Concentration" valueLabel="commits" />);
    expect(screen.getByRole("table", { name: /Concentration/i })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Gini coefficient" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Bus factor" })).toBeInTheDocument();
  });

  it("samples the table for a large population instead of pushing a row per person", () => {
    render(<ConcentrationCurve values={Array.from({ length: 400 }, (_, i) => i + 1)} />);
    // 11 sampled deciles + the two summary rows + the header row.
    expect(screen.getAllByRole("row")).toHaveLength(14);
  });
});

describe("ConcentrationCurve geometry", () => {
  it("draws the curve, the shaded gini area and the knee marker with finite coordinates", () => {
    const { container } = render(<ConcentrationCurve values={SKEWED} />);
    const curve = container.querySelector("[data-curve]")!.getAttribute("points")!;
    expect(curve).not.toContain("NaN");
    expect(container.querySelector("[data-gini]")!.getAttribute("d")).not.toContain("NaN");
    const knee = container.querySelector("[data-knee]")!;
    expect(Number.isFinite(Number(knee.getAttribute("cx")))).toBe(true);
  });

  it("degrades to a labelled placeholder rather than asserting a perfectly even org", () => {
    const { container } = render(<ConcentrationCurve values={[0, 0]} title="Concentration" />);
    expect(screen.getByRole("img", { name: /not enough data to measure concentration/i })).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });
});
