import { describe, it, expect } from "vitest";
import { presentPoints, deltaAt } from "@/components/report/DimLine";

// Pins DimLine's two pure helpers, which carry the crash-safety contract for the DimensionTrends
// white-screen (score-charts scan #1, High). `deltaAt` is the read-site "belt" to useChartHover's
// "braces": even if a stale/out-of-bounds hover index ever reaches it, it must return null, never
// dereference an absent element and throw mid-render.

describe("presentPoints", () => {
  it("keeps only non-null values and carries each point's ORIGINAL index (for meta / x alignment)", () => {
    // A null marks a scan where the dimension was ABSENT — it's a gap, not a hoverable point, but the
    // surrounding real points must keep their original indices so `meta[p.i]` stays aligned.
    expect(presentPoints([10, null, 30, null, 50])).toEqual([
      { v: 10, i: 0 },
      { v: 30, i: 2 },
      { v: 50, i: 4 },
    ]);
  });

  it("returns an empty array when every value is null (a fully-absent dimension)", () => {
    expect(presentPoints([null, null])).toEqual([]);
  });

  it("returns an empty array for an empty series", () => {
    expect(presentPoints([])).toEqual([]);
  });

  it("treats 0 as a real (hoverable) value, not a gap", () => {
    expect(presentPoints([0, null, 0])).toEqual([
      { v: 0, i: 0 },
      { v: 0, i: 2 },
    ]);
  });
});

describe("deltaAt", () => {
  const present = [
    { v: 10, i: 0 },
    { v: 25, i: 1 },
    { v: 20, i: 2 },
  ];

  it("returns null when nothing is hovered (active === null)", () => {
    expect(deltaAt(present, null)).toBe(null);
  });

  it("returns null for the first point (active === 0 has no prior scan to compare)", () => {
    expect(deltaAt(present, 0)).toBe(null);
  });

  it("returns the signed delta vs the prior PRESENT point", () => {
    expect(deltaAt(present, 1)).toBe(15); // 25 - 10 (a rise)
    expect(deltaAt(present, 2)).toBe(-5); // 20 - 25 (a fall)
  });

  it("REGRESSION: a stale/out-of-bounds index returns null instead of throwing (the white-screen)", () => {
    // The exact crash: a range toggle shrinks the series to 3 while active=20 is retained from the old
    // 40-point series. The old `present[20]!.v` threw; deltaAt must be a no-op.
    expect(() => deltaAt(present, 20)).not.toThrow();
    expect(deltaAt(present, 20)).toBe(null);
  });

  it("is defensive against a negative index", () => {
    expect(deltaAt(present, -1)).toBe(null);
  });

  it("returns null when only the prior point is out of bounds is impossible, but an empty series is safe", () => {
    expect(deltaAt([], 5)).toBe(null);
  });
});
