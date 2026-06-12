import { describe, it, expect } from "vitest";
import { estimateMonthlyCredits, MONTHLY_RUNS } from "./credit-estimate";
import { SCHEDULES } from "@/components/connect/installationRepoTypes";

describe("MONTHLY_RUNS", () => {
  it("covers every selectable schedule except 'off' (rates derive from the source array)", () => {
    for (const s of SCHEDULES) {
      if (s === "off") continue;
      expect(MONTHLY_RUNS[s], `missing monthly-run rate for schedule "${s}"`).toBeGreaterThan(0);
    }
  });
});

describe("estimateMonthlyCredits", () => {
  it("sums watched schedules at their monthly run rates", () => {
    expect(
      estimateMonthlyCredits([
        { watched: true, schedule: "daily" },
        { watched: true, schedule: "weekly" },
        { watched: true, schedule: "monthly" },
      ]),
    ).toBe(30 + 4 + 1);
  });
  it("ignores unwatched rows, 'off', and unknown/missing schedules", () => {
    expect(
      estimateMonthlyCredits([
        { watched: false, schedule: "daily" },
        { watched: true, schedule: "off" },
        { watched: true, schedule: "fortnightly" },
        { watched: true },
        {},
      ]),
    ).toBe(0);
  });
  it("is 0 for an empty fleet", () => {
    expect(estimateMonthlyCredits([])).toBe(0);
  });
});
