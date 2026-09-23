// The basis copy: what a percentage on the Delivery tab is a percentage OF.
//
// The producer has published these denominators since the fleet-rollups work and nothing rendered
// them, so the band's ten rates sat under one "N PRs across M repos" line that belonged to none of
// them. These pin the two claims that must never be fudged: an unknown denominator is stated as
// unknown (never backfilled from `analyzed`/`totalPrs`), and a rate no repo measured has no basis at
// all rather than a confident zero.

import { describe, expect, it } from "vitest";
import {
  BASIS_HINT,
  PRS_COLUMN_HINT,
  fleetBasisCopy,
  medianBasisCopy,
  prSectionBasisLine,
  repoBasisMark,
  repoBasisTitle,
} from "./prBasis";

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
  // /org redesign §2.3: the header description carries UNIT and COVERAGE only, at most 60 chars.
  // The denominator claim it used to carry is BASIS_HINT, disclosed through the header's WhyChip.
  it("states coverage as coverage, in unit/window form", () => {
    const line = prSectionBasisLine(5120, 40);
    expect(line).toBe("5,120 PRs analyzed · 40 repos");
    expect(line.length).toBeLessThanOrEqual(60);
  });

  it("keeps the demoted denominator claim reachable rather than deleting it", () => {
    expect(BASIS_HINT).toMatch(/do not share a denominator/);
    expect(PRS_COLUMN_HINT).toMatch(/analyzed count/);
  });
});

describe("fleetBasisCopy method (pooled vs volume-weighted)", () => {
  it("case 7: a pooled rate states its counts over its population", () => {
    const c = fleetBasisCopy("reviewed", { weight: 110, repos: 2, population: 20, method: "pooled", count: 11, legacyRepos: 0 })!;
    expect(c.short).toBe("basis: 11 of 20 · 2 repos");
    expect(c.full).toMatch(/11 of 20 human-authored merged PRs across 2 repos/);
    expect(c.full).not.toMatch(/weighted by/);
    expect(c.short + c.full).not.toMatch(/\u2014/);
  });

  it("case 7: a volume-weighted rate says it is weighted because scans predate per-rate counts", () => {
    const c = fleetBasisCopy("reviewed", { weight: 110, repos: 2, population: null, method: "volume-weighted", count: null, legacyRepos: 1 })!;
    expect(c.full).toMatch(/weighted by 110 analyzed PRs because 1 scan predates per-rate counts/);
    expect(c.short + c.full).not.toMatch(/\u2014/);
  });

  it("a pooled rate under its sample floor says why no percentage is published", () => {
    const c = fleetBasisCopy("reviewed", { weight: 40, repos: 2, population: 4, method: "pooled", count: 2, legacyRepos: 0 })!;
    expect(c.short).toBe("basis: 2 of 4 · 2 repos");
    expect(c.full).toMatch(/below the 5-PR floor/);
  });
});
