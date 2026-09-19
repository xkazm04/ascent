// The goal meter says WHICH question its percentage answers.
//
// `listGoals` returns `pct` with a `pctBasis`: a goal created with a baseline reports PROGRESS since
// it was set (opens empty), a goal created before baselines existed can only report ATTAINMENT,
// current over target (opens near-full). Rendered side by side with no label the two invite a
// comparison neither supports, and the attainment one systematically reads as "nearly done".
// These pin the two carriers every goal surface uses: the meter's accessible name, and the short
// visible marker reserved for the attainment case.

import { describe, expect, it } from "vitest";
import { GOAL_ATTAINMENT_MARKER, goalBasisMarker, goalMeterAriaLabel, readout } from "./goalViewLogic";
import { GOAL_PCT_LABEL } from "@/lib/db/plan";
import { forecastTrajectory } from "@/lib/maturity/forecast";
import type { GoalProgressView } from "./GoalViewTypes";

const base = { label: "Fleet to 70", current: 63, target: 70 };

describe("goalBasisMarker", () => {
  it("marks the attainment goal — the bar that opens near-full", () => {
    expect(goalBasisMarker({ pctBasis: "attainment" })).toBe(GOAL_ATTAINMENT_MARKER);
  });

  it("leaves a progress goal unmarked: the bar already means what a progress bar means", () => {
    expect(goalBasisMarker({ pctBasis: "progress" })).toBeNull();
  });

  it("leaves an older payload with no basis unmarked rather than guessing one", () => {
    expect(goalBasisMarker({})).toBeNull();
    expect(goalBasisMarker({ pctBasis: undefined })).toBeNull();
  });
});

describe("goalMeterAriaLabel", () => {
  it("appends the attainment caption verbatim, so every surface says the same thing", () => {
    expect(goalMeterAriaLabel({ ...base, pctLabel: GOAL_PCT_LABEL.attainment })).toBe(
      `Fleet to 70: 63 of 70 — ${GOAL_PCT_LABEL.attainment}`,
    );
  });

  it("appends the progress caption for a goal with a stored baseline", () => {
    expect(goalMeterAriaLabel({ ...base, pctLabel: GOAL_PCT_LABEL.progress })).toBe(
      `Fleet to 70: 63 of 70 — ${GOAL_PCT_LABEL.progress}`,
    );
  });

  it("states the numbers alone when the payload predates the basis fields (still a usable name)", () => {
    expect(goalMeterAriaLabel(base)).toBe("Fleet to 70: 63 of 70");
    expect(goalMeterAriaLabel({ ...base, pctLabel: undefined })).toBe("Fleet to 70: 63 of 70");
  });
});

function view(over: Partial<GoalProgressView> = {}): GoalProgressView {
  return {
    id: "g1",
    label: "Fleet to 70",
    metric: "overall",
    metricLabel: "Overall",
    target: 80,
    current: 60,
    pct: 50,
    achieved: false,
    status: "active",
    targetDate: "2026-03-01",
    pace: "behind",
    perWeek: 35,
    trajectory: "rising",
    fitQuality: 1,
    etaDays: 20,
    etaDate: "2026-02-21",
    requiredPerWeek: 15,
    laggards: [],
    belowCount: 0,
    ...over,
  };
}

describe("readout — presenters go through composeGoal so they cannot drop the hedge", () => {
  it("prints Delivery's refusal for a 2-scan-day fit, never the bare pace/ETA", () => {
    const thin = forecastTrajectory([
      { date: "2026-08-21", value: 60 },
      { date: "2026-08-22", value: 65 },
    ]);
    const line = readout(view({ forecast: thin }));
    expect(line).toContain("Not enough history to project");
    expect(line).not.toMatch(/On pace|Behind:|\/wk/);
  });

  it("falls back to local copy when the payload predates `forecast`", () => {
    expect(readout(view())).toMatch(/^Behind:/);
  });
});
