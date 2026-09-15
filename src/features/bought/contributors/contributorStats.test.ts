// The quantile maths behind the tab's distribution strips. Pure — no DOM, no DB.

import { describe, expect, it } from "vitest";
import { quantiles } from "./contributorStats";

describe("quantiles", () => {
  it("interpolates between order statistics rather than picking an arbitrary member", () => {
    // 0,10,20,30,40 → q1 sits on 10, median on 20, q3 on 30.
    expect(quantiles([40, 0, 20, 10, 30])).toEqual({ min: 0, q1: 10, median: 20, q3: 30, max: 40, n: 5 });
  });

  it("gives an even-sized set a median between the two middle values", () => {
    const five = quantiles([0, 10, 20, 30]);
    expect(five?.median).toBeCloseTo(15, 10);
    expect(five?.q1).toBeCloseTo(7.5, 10);
    expect(five?.q3).toBeCloseTo(22.5, 10);
  });

  it("returns null rather than a zero-width box for fewer than two usable values", () => {
    expect(quantiles([])).toBeNull();
    expect(quantiles([42])).toBeNull();
    // One finite value beside two holes is still one value: the holes are dropped, not zeroed.
    expect(quantiles([42, Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
  });

  it("drops non-finite entries instead of coercing them to zero, and reports the surviving n", () => {
    const five = quantiles([10, Number.NaN, 20, Number.NEGATIVE_INFINITY, 30]);
    expect(five?.n).toBe(3);
    expect(five?.min).toBe(10);
    expect(five?.max).toBe(30);
  });

  it("survives a degenerate set where every value is identical", () => {
    expect(quantiles([7, 7, 7])).toEqual({ min: 7, q1: 7, median: 7, q3: 7, max: 7, n: 3 });
  });
});
