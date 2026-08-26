import { describe, expect, it } from "vitest";

import {
  GREEN_MIN_SCORE,
  fleetGreenness,
  isDimGreen,
  repoGreenness,
  type DimScore,
} from "@/lib/maturity/green";

const dims = (...scores: number[]): DimScore[] => scores.map((score, i) => ({ dimId: `D${i + 1}`, score }));

describe("the green band", () => {
  it("is the top level, derived from LEVELS rather than a hardcoded 85", () => {
    expect(GREEN_MIN_SCORE).toBe(85);
    expect(isDimGreen(GREEN_MIN_SCORE)).toBe(true);
    expect(isDimGreen(GREEN_MIN_SCORE - 1)).toBe(false);
    expect(isDimGreen(100)).toBe(true);
  });

  it("rounds the way levelForScore does, so the boundary cannot drift between them", () => {
    expect(isDimGreen(84.5)).toBe(true); // rounds to 85
    expect(isDimGreen(84.4)).toBe(false);
  });
});

describe("repoGreenness", () => {
  it("is green only when EVERY dimension cleared the band", () => {
    expect(repoGreenness("a/b", dims(90, 95, 100)).green).toBe(true);
    expect(repoGreenness("a/b", dims(90, 95, 84)).green).toBe(false);
  });

  it("does not let a strong overall carry a weak dimension", () => {
    // Mean is ~85 and would read as green on an overall-score test; one dimension is at L2.
    const r = repoGreenness("a/b", dims(100, 100, 100, 100, 30));
    expect(r.green).toBe(false);
    expect(r.gaps.map((g) => g.dimId)).toEqual(["D5"]);
  });

  it("treats an unscanned repo as NOT green, and says why", () => {
    // The dangerous alternative is vacuous truth: zero dimensions, zero gaps, "green".
    const r = repoGreenness("a/b", []);
    expect(r.green).toBe(false);
    expect(r.unscanned).toBe(true);
    expect(r.gaps).toEqual([]);
  });

  it("reports the distance to the band and orders the widest gap first", () => {
    const r = repoGreenness("a/b", [
      { dimId: "D1", score: 80 },
      { dimId: "D2", score: 40 },
      { dimId: "D3", score: 90 },
    ]);
    expect(r.gaps.map((g) => [g.dimId, g.points])).toEqual([
      ["D2", 45],
      ["D1", 5],
    ]);
    expect(r.gaps[0]!.level).toBe("L2");
    expect(r.debt).toBe(50);
  });
});

describe("fleetGreenness", () => {
  it("is green only when every repo is", () => {
    const all = [repoGreenness("a/b", dims(90)), repoGreenness("c/d", dims(95))];
    expect(fleetGreenness(all).green).toBe(true);

    const mixed = [repoGreenness("a/b", dims(90)), repoGreenness("c/d", dims(50))];
    const f = fleetGreenness(mixed);
    expect(f.green).toBe(false);
    expect(f.greenCount).toBe(1);
    expect(f.remaining.map((r) => r.fullName)).toEqual(["c/d"]);
  });

  it("refuses vacuous truth: an EMPTY scope is not green", () => {
    // A misconfigured scope — nothing paired, nothing watched — must never read as a finished job.
    expect(fleetGreenness([]).green).toBe(false);
  });

  it("orders remaining work by debt so bounded cycles are spent where the distance is", () => {
    const f = fleetGreenness([
      repoGreenness("small/gap", dims(80)),
      repoGreenness("big/gap", dims(20)),
      repoGreenness("is/green", dims(99)),
    ]);
    expect(f.remaining.map((r) => r.fullName)).toEqual(["big/gap", "small/gap"]);
    expect(f.totalDebt).toBe(65 + 5);
  });
});
