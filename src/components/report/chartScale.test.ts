import { describe, it, expect } from "vitest";
import { vScale, xScale } from "@/components/report/chartScale";

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
