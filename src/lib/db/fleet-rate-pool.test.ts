// The fleet fold for a PR rate: pooled counts over pooled populations wherever every contributor
// persisted the rate book, today's analyzed-weighted mean wherever one did not.
//
// The defect this pins: review coverage is a share of HUMAN-MERGED PRs, and a 100-PR repo with 10
// human merges outvoted a 10-PR repo with 10 human merges ten to one because the fleet weighted each
// rounded percentage by `analyzed`. 1 of 10 plus 10 of 10 is 11 of 20 (55%), never 18%.

import { describe, expect, it } from "vitest";
import { qualifiedRate } from "@/lib/analyze/pr-thresholds";
import { bookCounts, poolFleetRate, volumeWeighted, type RateContribution } from "./fleet-rate-pool";

const c = (analyzed: number, percent: number | null, counts: [number, number] | null, population?: number | null): RateContribution => ({
  analyzed,
  percent,
  counts: counts ? { count: counts[0], population: counts[1] } : null,
  ...(population !== undefined ? { population } : {}),
});

describe("poolFleetRate", () => {
  it("case 1: pools review coverage as 11 of 20 (55), not the analyzed-weighted 18", () => {
    const r = poolFleetRate("reviewed", [c(100, 10, [1, 10]), c(10, 100, [10, 10])]);
    expect(r.percent).toBe(55);
    expect(r).toMatchObject({ method: "pooled", count: 11, population: 20, repos: 2, legacyRepos: 0 });
  });

  it("case 2: pools AI governance as 12 of 16 (75), not 54", () => {
    const r = poolFleetRate("aiGoverned", [c(100, 50, [3, 6]), c(10, 90, [9, 10])]);
    expect(r.percent).toBe(75);
    expect(r).toMatchObject({ method: "pooled", count: 12, population: 16 });
  });

  it("case 3: applies RATE_BASIS.minSample to the POOLED population, not to each repo", () => {
    // Each repo's scalar is null under its own floor (2 and 4 human merges), the pool of 6 clears 5.
    expect(poolFleetRate("reviewed", [c(20, null, [1, 2]), c(20, null, [4, 4])]).percent).toBe(83);
    const under = poolFleetRate("reviewed", [c(20, null, [1, 2]), c(20, null, [1, 2])]);
    expect(under.percent).toBeNull(); // not measurable, never 0
    expect(under).toMatchObject({ method: "pooled", population: 4, count: 2 });
  });

  it("case 4: blobs with no rate book keep today's analyzed-weighted arithmetic", () => {
    const r = poolFleetRate("reviewed", [c(100, 10, null), c(10, 100, null)]);
    expect(r.percent).toBe(18); // round((10*100 + 100*10) / 110)
    expect(r).toMatchObject({ method: "volume-weighted", count: null, legacyRepos: 2, weight: 110, repos: 2 });
  });

  it("case 5: a mixed fleet does not partially pool, and names the legacy repos", () => {
    const r = poolFleetRate("reviewed", [c(100, 10, [1, 10]), c(10, 100, null)]);
    expect(r.method).toBe("volume-weighted");
    expect(r.percent).toBe(18);
    expect(r.legacyRepos).toBe(1);
  });

  it("guard: populations proportional to analyzed publish the same number either way", () => {
    const pooled = poolFleetRate("smallPr", [c(10, 70, [7, 10]), c(30, 40, [12, 30])]);
    const weighted = poolFleetRate("smallPr", [c(10, 70, null), c(30, 40, null)]);
    expect(pooled.method).toBe("pooled");
    expect(pooled.percent).toBe(weighted.percent);
  });

  it("an empty contribution list is nothing to pool: volume-weighted, null, no repos", () => {
    expect(poolFleetRate("revert", [])).toMatchObject({ percent: null, method: "volume-weighted", repos: 0, legacyRepos: 0 });
  });

  it("a repo with an empty population is in the pool but not counted as a contributing repo", () => {
    const r = poolFleetRate("aiGoverned", [c(10, null, [0, 0]), c(20, 80, [8, 10])]);
    expect(r).toMatchObject({ method: "pooled", count: 8, population: 10, repos: 1, weight: 20, percent: 80 });
  });
});

describe("volumeWeighted", () => {
  it("guard: skips a null 'no sample' repo and sums the known populations", () => {
    expect(volumeWeighted([c(1, 100, null, 1), c(9, 50, null, 9), c(100, null, null, 100)])).toEqual({
      percent: 55,
      weight: 10,
      repos: 2,
      population: 10,
    });
  });

  it("drops the population to null when a contributor never persisted one", () => {
    expect(volumeWeighted([c(10, 50, null, 5), c(10, 50, null, null)]).population).toBeNull();
  });
});

describe("bookCounts", () => {
  it("reads a finite count and population from the rate book", () => {
    expect(bookCounts({ reviewed: qualifiedRate("reviewed", 3, 7) }, "reviewed")).toEqual({ count: 3, population: 7 });
  });

  it("treats a missing book, a missing id, or a drifted entry as absent (never a 0 of 0)", () => {
    expect(bookCounts(undefined, "reviewed")).toBeNull();
    expect(bookCounts({ smallPr: qualifiedRate("smallPr", 1, 2) }, "reviewed")).toBeNull();
    expect(bookCounts({ reviewed: { count: "3", population: 7 } }, "reviewed")).toBeNull();
    expect(bookCounts({ reviewed: { count: 9, population: 7 } }, "reviewed")).toBeNull();
    expect(bookCounts({ reviewed: { count: -1, population: 7 } }, "reviewed")).toBeNull();
  });
});
