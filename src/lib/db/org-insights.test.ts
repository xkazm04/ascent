// Regression test for the benchmark sample floor (biz-bug-scan-2026-06-11, org-scanning #4):
// the headline corpus percentile had no minimum-sample gate, so a young deployment with a 1-repo
// corpus told its first org "you beat 100% of orgs" (or 0%) — verbatim in the dashboard and the
// weekly digest. The cohort path already gated behind COHORT_MIN = 5; percentileOf now carries
// that discipline for both call sites.

import { describe, expect, it } from "vitest";
import { percentileOf } from "@/lib/db/org-insights";

describe("percentileOf", () => {
  it("returns null below the sample floor instead of a hard 0/100", () => {
    expect(percentileOf([70], 90, 5)).toBeNull(); // would have been "100th percentile" of one repo
    expect(percentileOf([70], 10, 5)).toBeNull(); // would have been "0th percentile"
    expect(percentileOf([60, 70, 80, 90], 75, 5)).toBeNull(); // 4 < CORPUS_MIN
  });

  it("ranks normally at-or-above the floor", () => {
    expect(percentileOf([10, 20, 30, 40, 50], 35, 5)).toBe(60); // 3 of 5 at-or-below
    expect(percentileOf([10, 20, 30, 40, 50], 5, 5)).toBe(0);
    expect(percentileOf([10, 20, 30, 40, 50], 99, 5)).toBe(100);
  });

  it("treats an empty corpus as no rank even with the default floor", () => {
    expect(percentileOf([], 50)).toBeNull();
  });

  it("clamps a zero/negative floor to 1 (empty input can never rank)", () => {
    expect(percentileOf([42], 42, 0)).toBe(100);
    expect(percentileOf([], 42, 0)).toBeNull();
  });
});
