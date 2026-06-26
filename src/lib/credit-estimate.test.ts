import { describe, it, expect } from "vitest";
import { estimateMonthlyCredits, MONTHLY_RUNS, scheduledRunsPerMonth } from "./credit-estimate";
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

  it("subtracts the plan's remaining free allowance, clamped at 0 (no overstated spend)", () => {
    const fleet = [
      { watched: true, schedule: "daily" }, // 30 runs
      { watched: true, schedule: "weekly" }, // 4 runs  → 34 raw runs
    ];
    // The full schedule is 34 runs/month; an org with 40 free scans left this month draws nothing.
    expect(estimateMonthlyCredits(fleet, 40)).toBe(0);
    // With only 10 free scans left, the 24-run overflow is what actually costs credits.
    expect(estimateMonthlyCredits(fleet, 10)).toBe(34 - 10);
    // A 0 / negative allowance behaves like the raw upper bound (back-compat with the no-arg form).
    expect(estimateMonthlyCredits(fleet, 0)).toBe(34);
    expect(estimateMonthlyCredits(fleet)).toBe(34);
    expect(estimateMonthlyCredits(fleet, -5)).toBe(34);
  });
});

describe("scheduledRunsPerMonth", () => {
  it("returns the raw run count before any allowance is netted out", () => {
    expect(
      scheduledRunsPerMonth([
        { watched: true, schedule: "daily" },
        { watched: true, schedule: "weekly" },
        { watched: false, schedule: "daily" },
      ]),
    ).toBe(30 + 4);
  });
});
