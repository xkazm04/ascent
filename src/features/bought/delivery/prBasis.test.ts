// The basis copy: what a percentage on the Delivery tab is a percentage OF.
//
// The producer has published these denominators since the fleet-rollups work and nothing rendered
// them, so the band's ten rates sat under one "N PRs across M repos" line that belonged to none of
// them. These pin the two claims that must never be fudged: an unknown denominator is stated as
// unknown (never backfilled from `analyzed`/`totalPrs`), and a rate no repo measured has no basis at
// all rather than a confident zero.

import { describe, expect, it } from "vitest";
import { fleetBasisCopy, medianBasisCopy, repoBasisMark, repoBasisTitle, prSectionBasisLine } from "./prBasis";

describe("fleetBasisCopy", () => {
  it("names the population, the denominator and the contributing repo count", () => {
    const c = fleetBasisCopy("reviewed", { weight: 1200, repos: 2, population: 340 })!;
    expect(c.short).toBe("basis: 340 · 2 repos");
    expect(c.full).toMatch(/Over|Measured over 340 human-authored merged PRs across 2 repos/);
    expect(c.full).toMatch(/weighted by 1,200 analyzed PRs/);
  });

  it("says the sample size is unknown when a contributing scan never persisted it", () => {
    const c = fleetBasisCopy("aiGoverned", { weight: 500, repos: 3, population: null })!;
    expect(c.short).toMatch(/sample size unknown/);
    expect(c.full).toMatch(/not persisted by every contributing scan/);
    expect(c.short).not.toMatch(/500/); // the weight is not smuggled in as a denominator
  });

  it("returns nothing for a rate no repo measured — the cell renders an em dash, not a basis", () => {
    expect(fleetBasisCopy("revert", { weight: 0, repos: 0, population: null })).toBeNull();
    expect(fleetBasisCopy("revert", undefined)).toBeNull();
  });

  it("uses the singular for one repo", () => {
    expect(fleetBasisCopy("merge", { weight: 10, repos: 1, population: 9 })!.short).toBe("basis: 9 · 1 repo");
  });
});

describe("medianBasisCopy", () => {
  it("counts repos, and says the reading is a mean of per-repo medians", () => {
    const c = medianBasisCopy(4, "hours to merge")!;
    expect(c.short).toBe("basis: 4 repos");
    expect(c.full).toMatch(/unweighted mean of the per-repo median hours to merge/);
    expect(c.full).toMatch(/not a fleet-wide median/);
  });

  it("is null when no repo recorded a median", () => {
    expect(medianBasisCopy(0, "hours to merge")).toBeNull();
  });
});

describe("per-repo basis", () => {
  it("marks a known denominator and refuses to invent an unknown one", () => {
    expect(repoBasisMark(42)).toBe("/42");
    expect(repoBasisMark(undefined)).toBeNull();
  });

  it("titles each rate with the denominator it is actually over", () => {
    expect(repoBasisTitle("merge", 38)).toBe("Over 38 decided PRs (merged + closed unmerged).");
    expect(repoBasisTitle("aiGoverned", undefined)).toMatch(/not persisted by this scan/);
  });
});

describe("prSectionBasisLine", () => {
  it("states coverage as coverage and hands each rate its own population", () => {
    const line = prSectionBasisLine(5120, 40);
    expect(line).toMatch(/5,120 PRs analyzed across 40 repos/);
    expect(line).toMatch(/each rate below names its own population/);
  });
});
