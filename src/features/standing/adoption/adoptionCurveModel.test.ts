// The adoption curve model — the picture and its sr-only table are both built from these numbers,
// so an error here is an error in both at once.

import { describe, expect, it } from "vitest";
import { ANY_THRESHOLD, HEAVY_THRESHOLD, buildAdoptionCurve, curveSummary } from "./adoptionCurveModel";

const dist = (high: number, some: number, none: number) => ({ high, some, none });

describe("buildAdoptionCurve — three measured thresholds", () => {
  it("plots the survival curve: everyone, then ≥1%, then ≥50%", () => {
    const m = buildAdoptionCurve(dist(6, 12, 22), 40, 32);
    expect(m.ok).toBe(true);
    expect(m.marks.map((k) => [k.threshold, k.count])).toEqual([
      [0, 40],
      [ANY_THRESHOLD, 18],
      [HEAVY_THRESHOLD, 6],
    ]);
    expect(m.marks[1]!.share).toBeCloseTo(45);
    expect(m.marks[2]!.share).toBeCloseTo(15);
  });

  it("is non-increasing — the curve can never rise as the threshold rises", () => {
    const m = buildAdoptionCurve(dist(3, 5, 2), 10);
    const shares = m.marks.map((k) => k.share);
    for (let i = 1; i < shares.length; i += 1) expect(shares[i]!).toBeLessThanOrEqual(shares[i - 1]!);
  });

  it("bounds the unobserved interior instead of interpolating it", () => {
    const m = buildAdoptionCurve(dist(6, 12, 22), 40);
    const mid = m.gaps.find((g) => g.from === ANY_THRESHOLD)!;
    expect(mid.to).toBe(HEAVY_THRESHOLD);
    expect(mid.hi).toBeCloseTo(45);
    expect(mid.lo).toBeCloseTo(15);
    // Every gap is a real envelope, never a hairline asserting a value.
    for (const g of m.gaps) expect(g.hi).toBeGreaterThan(g.lo);
  });

  it("drops the tail envelope when nobody is heavy — a zero-height band would read as a measurement", () => {
    const m = buildAdoptionCurve(dist(0, 4, 6), 10);
    expect(m.gaps.some((g) => g.from === HEAVY_THRESHOLD)).toBe(false);
    expect(m.marks[2]!.count).toBe(0);
  });
});

describe("buildAdoptionCurve — absence is never a zero", () => {
  it("counts contributors no bucket claims as unclassified, not as 'none'", () => {
    const m = buildAdoptionCurve(dist(1, 2, 3), 10);
    expect(m.ok).toBe(true);
    expect(m.unclassified).toBe(4);
    expect(curveSummary(m)).toContain("an absence, not a zero");
  });

  it("refuses to plot an empty population rather than drawing a flat curve at zero", () => {
    const m = buildAdoptionCurve(dist(0, 0, 0), 0);
    expect(m.ok).toBe(false);
    expect(m.marks).toHaveLength(0);
  });

  it("refuses an incoherent payload (buckets exceeding the headcount)", () => {
    expect(buildAdoptionCurve(dist(5, 5, 5), 4).ok).toBe(false);
    expect(buildAdoptionCurve({ high: Number.NaN, some: 1, none: 1 }, 5).ok).toBe(false);
  });
});

describe("buildAdoptionCurve — the org reference tick", () => {
  it("carries a finite org share and clamps it onto the axis", () => {
    expect(buildAdoptionCurve(dist(1, 1, 1), 3, 32).orgShare).toBe(32);
    expect(buildAdoptionCurve(dist(1, 1, 1), 3, 140).orgShare).toBe(100);
  });

  it("is null — never 0 — when the share is unavailable", () => {
    expect(buildAdoptionCurve(dist(1, 1, 1), 3, null).orgShare).toBeNull();
    expect(buildAdoptionCurve(dist(1, 1, 1), 3).orgShare).toBeNull();
    expect(buildAdoptionCurve(dist(1, 1, 1), 3, Number.NaN).orgShare).toBeNull();
  });
});

describe("curveSummary", () => {
  it("states the population behind every share", () => {
    const s = curveSummary(buildAdoptionCurve(dist(6, 12, 22), 40, 32));
    expect(s).toContain("40 contributors");
    expect(s).toContain("18 of 40 at ≥1% AI (45%)");
    expect(s).toContain("bounded but not measured");
  });
});
