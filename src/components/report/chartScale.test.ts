import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DimensionResult } from "@/lib/types";
import { BAND_EDGES, L4_FLOOR, LEVEL_BANDS, vScale, xScale } from "@/components/report/chartScale";
import { dimFacts, explorerSummary } from "@/components/report/dimensionExplorerDerive";
import { Sparkline } from "@/components/report/TrendChart.Sparkline";
import { DimLine } from "@/components/report/DimLine";
import type { TrendPoint } from "@/components/report/TrendChart";

// The rubric with its L4 (Integrated) floor retuned 65 -> 70, so a chart that still hand-types 65
// is caught. Only LEVELS / LEVEL_BY_ID move; the scale helpers below do not read the rubric at all.
vi.mock("@/lib/maturity/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/maturity/model")>();
  const LEVELS = actual.LEVELS.map((l) => (l.id === "L4" ? { ...l, band: [70, 84] as [number, number] } : l));
  return { ...actual, LEVELS, LEVEL_BY_ID: Object.fromEntries(LEVELS.map((l) => [l.id, l])) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// These are the load-bearing, defensive scale helpers every SVG line chart (TrendChart, Sparkline,
// DimLine) routes through. Their whole reason for existing is the NaN/clamp guard documented at
// chartScale.ts:24-27: an unvalidated history point must never produce a NaN y (which silently
// breaks the entire <path>) or a coordinate plotted outside the chart box. The xScale single-point
// centering keeps a one-scan chart's dot in the middle instead of left-pinned. Pin all of it.

describe("vScale", () => {
  // vScale(100, 8, 8): span = 100 - 8 - 8 = 84.
  // top inset = 8, bottom edge = height - bottom = 92, midpoint = 50.
  const HEIGHT = 100;
  const TOP = 8;
  const BOTTOM = 8;
  const TOP_Y = TOP; // 8  (highest score sits at the top inset)
  const BOTTOM_Y = HEIGHT - BOTTOM; // 92 (lowest score sits at the bottom edge)
  const yFor = vScale(HEIGHT, TOP, BOTTOM);

  it("maps in-domain scores to the correct pixel (monotonic-decreasing: higher score = smaller y)", () => {
    expect(yFor(100)).toBe(TOP_Y); // 8  — top
    expect(yFor(0)).toBe(BOTTOM_Y); // 92 — bottom
    expect(yFor(50)).toBe(50); // 8 + 84*0.5 — exact midpoint
    // Strictly monotonic decreasing across the domain.
    expect(yFor(0)).toBeGreaterThan(yFor(25));
    expect(yFor(25)).toBeGreaterThan(yFor(50));
    expect(yFor(50)).toBeGreaterThan(yFor(75));
    expect(yFor(75)).toBeGreaterThan(yFor(100));
  });

  it("clamps out-of-domain inputs to the domain edge (never plots outside the box)", () => {
    expect(yFor(-20)).toBe(yFor(0)); // below domain → bottom edge
    expect(yFor(120)).toBe(yFor(100)); // above domain → top edge
    expect(yFor(-9999)).toBe(BOTTOM_Y);
    expect(yFor(9999)).toBe(TOP_Y);
  });

  it("NaN-guard: non-finite inputs map to a SAFE finite coordinate (the documented y for score 0)", () => {
    // The keystone invariant the guard exists to hold: a NaN/Infinity score can NEVER produce a
    // NaN y that would silently corrupt the SVG <path>. Per the guard, non-finite → treated as 0.
    for (const bad of [NaN, Infinity, -Infinity]) {
      const y = yFor(bad);
      expect(Number.isFinite(y)).toBe(true); // never NaN/Infinity in the output
      expect(y).toBe(BOTTOM_Y); // non-finite is coerced to score 0 → bottom edge
    }
  });

  it("every output stays within [top, height - bottom] for any input, finite or not", () => {
    const inputs = [NaN, Infinity, -Infinity, -1000, -1, 0, 33.33, 50, 100, 101, 1e9];
    for (const v of inputs) {
      const y = yFor(v);
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(TOP_Y);
      expect(y).toBeLessThanOrEqual(BOTTOM_Y);
    }
  });

  it("handles a zero-span chart without divide-by-zero NaN (every point collapses to top)", () => {
    // height === top + bottom → span 0. Geometry must still be finite (no 0/0), not NaN.
    const flat = vScale(16, 8, 8); // span = 0
    for (const v of [0, 50, 100, NaN, Infinity, -5, 200]) {
      const y = flat(v);
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBe(8); // top + 0*… = top, always
    }
  });
});

describe("xScale", () => {
  it("centers a single point (or zero points) so a one-scan chart's dot sits mid-width", () => {
    expect(xScale(1, 0, 320)(0)).toBe(160); // left + width/2
    expect(xScale(0, 0, 320)(0)).toBe(160); // count < 2 → centered, no divide-by-(count-1)=−1 skew
    expect(xScale(1, 40, 200)(0)).toBe(140); // 40 + 200/2
  });

  it("spans the full [left, left+width] with evenly-spaced indices for count >= 2", () => {
    const x = xScale(5, 0, 320); // step = 320 / (5-1) = 80
    expect(x(0)).toBe(0); // first at left
    expect(x(4)).toBe(320); // last at left+width
    expect(x(1)).toBe(80);
    expect(x(2)).toBe(160);
    expect(x(3)).toBe(240);
    // Even spacing: constant delta between consecutive indices.
    const deltas = [x(1) - x(0), x(2) - x(1), x(3) - x(2), x(4) - x(3)];
    for (const d of deltas) expect(d).toBe(80);
  });

  it("respects a non-zero left offset across the full span", () => {
    const x = xScale(2, 50, 100);
    expect(x(0)).toBe(50); // left
    expect(x(1)).toBe(150); // left + width
  });

  it("never yields a non-finite x for the supported count/left/width inputs", () => {
    for (const [count, left, width] of [
      [0, 0, 320],
      [1, 0, 320],
      [2, 0, 320],
      [5, 10, 300],
    ] as const) {
      const x = xScale(count, left, width);
      for (let i = 0; i < Math.max(1, count); i++) {
        expect(Number.isFinite(x(i))).toBe(true);
      }
    }
  });
});

// The level-band edges belong to the rubric (LEVELS in @/lib/maturity/model), the source the
// AltimeterGauge strata and the score colors already read. The chart ramp, the explorer's
// "at Integrated or above" count and the two sparkline L4 references used to hand-type 65; with the
// rubric's L4 floor moved to 70 here, every one of them must move with it.
describe("level bands follow the rubric (L4 floor retuned to 70)", () => {
  it("LEVEL_BANDS mins and BAND_EDGES are derived from LEVELS", () => {
    expect(LEVEL_BANDS.map((b) => b.min)).toEqual([85, 70, 45, 25, 0]);
    expect([...BAND_EDGES]).toEqual([0, 25, 45, 70, 85, 100]);
    expect(L4_FLOOR).toBe(70);
  });

  it("explorerSummary does not count a 66 as Integrated or above", () => {
    const d = { id: "D2", name: "D2", score: 66, weight: 0.15, signalScore: 66, llmScore: 66, summary: "", evidence: [], strengths: [], gaps: [] } as DimensionResult;
    expect(explorerSummary([dimFacts(d, undefined)])!.atL4).toBe(0);
    expect(explorerSummary([dimFacts({ ...d, score: 70 }, undefined)])!.atL4).toBe(1);
  });

  it("Sparkline's dashed L4 reference sits at y(70)", () => {
    const html = renderToStaticMarkup(createElement(Sparkline, { points: [{ at: "2026-07-01T00:00:00.000Z", score: 50 }, { at: "2026-07-02T00:00:00.000Z", score: 60 }] as TrendPoint[] }));
    const y70 = vScale(34, 3, 3)(70);
    expect(html).toMatch(new RegExp(`<line[^>]*y1="${y70}"[^>]*stroke-dasharray="2 3"`));
    expect(html).not.toContain(`y1="${vScale(34, 3, 3)(65)}"`);
  });

  it("DimLine's threshold label reads 70 and sits at y(70)", () => {
    const html = renderToStaticMarkup(createElement(DimLine, { values: [50, 60], meta: [{ at: "2026-07-01T00:00:00.000Z", engine: "claude-cli" }, { at: "2026-07-02T00:00:00.000Z", engine: "claude-cli" }] }));
    expect(html).toMatch(new RegExp(`<text[^>]*y="${vScale(90, 8, 8)(70) - 2}"[^>]*>70</text>`));
    expect(html).not.toMatch(/>65<\/text>/);
  });
});
