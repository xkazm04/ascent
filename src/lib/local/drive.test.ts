import { describe, expect, it } from "vitest";

import { DRIVE_MAX_RUNS_CAP, nextDriveStep, type DriveMeasurement } from "@/lib/local/drive";

const m = (over: Partial<DriveMeasurement>): DriveMeasurement => ({
  debt: 100,
  green: false,
  greenCount: 0,
  inScope: 2,
  remaining: ["o/worst", "o/better"],
  unscanned: [],
  ...over,
});

describe("nextDriveStep — three honest ways to stop, no fourth", () => {
  it("runs the remaining repos, worst first, when there is debt and rope", () => {
    expect(nextDriveStep(m({}), null, 0, 3)).toEqual({ action: "run", repos: ["o/worst", "o/better"] });
  });

  it("stops on green even when it still has runs left", () => {
    expect(nextDriveStep(m({ green: true, debt: 0, remaining: [] }), m({ debt: 40 }), 1, 3)).toEqual({ action: "stop", phase: "green" });
  });

  it("stops DRY when a whole run moved nothing — before spending the ceiling proving it again", () => {
    expect(nextDriveStep(m({ debt: 100 }), m({ debt: 100 }), 1, 3)).toEqual({ action: "stop", phase: "dry" });
    // Debt going UP after a run is also dry: the agent made it worse, and re-asking will not help.
    expect(nextDriveStep(m({ debt: 104 }), m({ debt: 100 }), 1, 3)).toEqual({ action: "stop", phase: "dry" });
  });

  it("continues while debt is falling, then hits the ceiling", () => {
    expect(nextDriveStep(m({ debt: 80 }), m({ debt: 100 }), 1, 3)).toEqual({ action: "run", repos: ["o/worst", "o/better"] });
    expect(nextDriveStep(m({ debt: 60 }), m({ debt: 80 }), 3, 3)).toEqual({ action: "stop", phase: "ceiling" });
  });

  it("does not report dry on the very first measurement (nothing to compare against)", () => {
    expect(nextDriveStep(m({}), null, 0, 1).action).toBe("run");
  });

  it("has a hard cap on the rope", () => {
    expect(DRIVE_MAX_RUNS_CAP).toBeLessThanOrEqual(8);
  });
});
