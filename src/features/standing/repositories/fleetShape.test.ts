// The fleet distribution's arithmetic, pinned without a DOM — the picture and its sr-only table are
// generated from exactly these numbers.

import { describe, it, expect } from "vitest";
import { fleetScoreShape, fleetShapeStates, quantiles } from "./fleetShape";

const repo = (overall: number | null) => ({ latest: overall == null ? null : { overall } });

describe("quantiles", () => {
  it("interpolates between order statistics (R-7)", () => {
    expect(quantiles([1, 2, 3, 4])).toEqual({ min: 1, q1: 1.75, median: 2.5, q3: 3.25, max: 4, n: 4 });
  });

  it("returns null rather than a zero-width box for fewer than two values", () => {
    expect(quantiles([])).toBeNull();
    expect(quantiles([42])).toBeNull();
  });

  it("DROPS non-finite entries instead of coercing them to zero", () => {
    const q = quantiles([10, Number.NaN, 20, Number.POSITIVE_INFINITY, 30]);
    expect(q).toMatchObject({ min: 10, median: 20, max: 30, n: 3 });
  });

  it("survives a set with no spread", () => {
    expect(quantiles([50, 50, 50])).toEqual({ min: 50, q1: 50, median: 50, q3: 50, max: 50, n: 3 });
  });
});

describe("fleetScoreShape", () => {
  it("summarises the scored repos and counts the unscanned ones separately", () => {
    const shape = fleetScoreShape([repo(20), repo(80), repo(null), repo(50), repo(null)]);
    expect(shape.scored).toBe(3);
    expect(shape.unscored).toBe(2);
    expect(shape.five).toMatchObject({ min: 20, median: 50, max: 80, n: 3 });
  });

  it("never lets an unscanned repo enter the box as a zero", () => {
    const shape = fleetScoreShape([repo(90), repo(70), repo(null)]);
    expect(shape.five!.min).toBe(70);
  });

  it("has no five-number summary when only one repo is scored", () => {
    const shape = fleetScoreShape([repo(90), repo(null)]);
    expect(shape.five).toBeNull();
    expect(shape.scored).toBe(1);
  });
});

describe("fleetShapeStates", () => {
  it("names measured only when something is scored, and not-judged only when something is not", () => {
    expect(fleetShapeStates(fleetScoreShape([repo(10), repo(20)]))).toEqual(["measured"]);
    expect(fleetShapeStates(fleetScoreShape([repo(null)]))).toEqual(["not-judged"]);
    expect(fleetShapeStates(fleetScoreShape([repo(10), repo(null)]))).toEqual(["measured", "not-judged"]);
    expect(fleetShapeStates(fleetScoreShape([]))).toEqual([]);
  });
});
