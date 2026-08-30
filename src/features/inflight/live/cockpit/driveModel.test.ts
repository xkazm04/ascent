// The drive's on-screen arithmetic. Two things here are load-bearing and neither is obvious:
//
//   - progress is `null`, not 0, until a run has been measured — a fresh drive has burned nothing
//     AND achieved nothing, and 0% is a claim about the second when only the first is known;
//   - `dry` and `ceiling` both end with debt on the table but call for OPPOSITE next moves, so the
//     verdicts must not read the same.

import { describe, expect, it } from "vitest";
import { driveProgress, driveResume, driveVerdict, lastDriveRunId } from "./driveModel";
import type { DriveMeasurement, DrivePhase, DriveRunRecord, DriveStatus } from "./driveTypes";

const measure = (over: Partial<DriveMeasurement> = {}): DriveMeasurement => ({
  debt: 80,
  green: false,
  greenCount: 1,
  inScope: 3,
  remaining: ["o/a", "o/b"],
  unscanned: [],
  ...over,
});

const runRec = (over: Partial<DriveRunRecord> = {}): DriveRunRecord => ({
  runId: "run-1",
  repos: ["o/a", "o/b"],
  debtBefore: 120,
  debtAfter: 80,
  startedAt: "2026-08-28T10:00:00Z",
  endedAt: "2026-08-28T10:20:00Z",
  ...over,
});

const status = (over: Partial<DriveStatus> = {}): DriveStatus => ({
  id: "drive_1",
  org: "acme",
  phase: "running" as DrivePhase,
  repos: ["o/a", "o/b", "o/c"],
  maxRuns: 3,
  maxCycles: 3,
  concurrency: 2,
  runs: [],
  measurement: measure(),
  runsBefore: 0,
  resumedFrom: null,
  startedAt: "2026-08-28T10:00:00Z",
  endedAt: null,
  error: null,
  stopRequested: false,
  ...over,
});

describe("driveProgress", () => {
  it("refuses to draw progress before a run has been measured", () => {
    const p = driveProgress(status({ runs: [] }));
    expect(p.debtStart).toBeNull();
    expect(p.debtDrop).toBeNull();
    expect(p.burned).toBeNull();
    expect(p.runsDone).toBe(0);
    expect(p.currentRunId).toBeNull();
  });

  it("burns debt against the debt the drive STARTED with, not the last run's", () => {
    const p = driveProgress(
      status({
        runs: [runRec(), runRec({ runId: "run-2", debtBefore: 80, debtAfter: 50 })],
        measurement: measure({ debt: 50 }),
      }),
    );
    expect(p.debtStart).toBe(120);
    expect(p.debtNow).toBe(50);
    expect(p.debtDrop).toBe(70);
    expect(p.burned).toBeCloseTo(70 / 120, 5);
    expect(p.runsDone).toBe(2);
  });

  it("names the run it is waiting on, and only while that run is open", () => {
    const open = runRec({ runId: "run-2", debtAfter: null, endedAt: null });
    const p = driveProgress(status({ runs: [runRec(), open] }));
    expect(p.currentRunId).toBe("run-2");
    expect(p.runsDone).toBe(1);
    expect(driveProgress(status({ runs: [runRec()] })).currentRunId).toBeNull();
  });

  it("clamps a debt that went UP rather than reporting negative progress", () => {
    const p = driveProgress(status({ runs: [runRec({ debtAfter: 140 })], measurement: measure({ debt: 140 }) }));
    expect(p.debtDrop).toBe(-20);
    expect(p.burned).toBe(0);
  });

  it("is live only while the phase is running AND nothing has ended it", () => {
    expect(driveProgress(status()).live).toBe(true);
    expect(driveProgress(status({ endedAt: "2026-08-28T11:00:00Z" })).live).toBe(false);
    expect(driveProgress(status({ phase: "green" })).live).toBe(false);
  });

  it("falls back to the drive's own scope when nothing has been measured yet", () => {
    const p = driveProgress(status({ measurement: null }));
    expect(p.inScope).toBe(3);
    expect(p.greenCount).toBe(0);
    expect(p.remaining).toEqual([]);
    expect(p.debtNow).toBeNull();
  });
});

describe("driveVerdict — the three honest stops read differently", () => {
  const runs = [runRec(), runRec({ runId: "run-2" })];

  it("green says the target was reached, and in how many runs", () => {
    const v = driveVerdict(status({ phase: "green", endedAt: "x", runs, measurement: measure({ green: true, debt: 0, greenCount: 3, remaining: [] }) }));
    expect(v.tone).toBe("green");
    expect(v.label).toBe("Green");
    expect(v.detail).toMatch(/2 runs/);
  });

  it("dry blames the stall, not the budget", () => {
    const v = driveVerdict(status({ phase: "dry", endedAt: "x", runs }));
    expect(v.label).toBe("Dry");
    expect(v.detail).toMatch(/moved nothing/);
    expect(v.detail).toMatch(/2 still short/);
    expect(v.detail).not.toMatch(/budget/);
  });

  it("ceiling blames the budget and says what to change", () => {
    const v = driveVerdict(status({ phase: "ceiling", endedAt: "x", runs }));
    expect(v.label).toBe("Ceiling");
    expect(v.detail).toMatch(/3 runs/);
    expect(v.detail).toMatch(/Raise the run budget/);
  });

  it("carries the engine's own message on failure", () => {
    const v = driveVerdict(status({ phase: "error", endedAt: "x", error: "A drive is already running." }));
    expect(v.tone).toBe("danger");
    expect(v.detail).toBe("A drive is already running.");
  });

  it("counts the in-flight run while it is still driving", () => {
    const open = runRec({ runId: "run-2", debtAfter: null, endedAt: null });
    expect(driveVerdict(status({ runs: [runRec(), open] })).detail).toBe("Run 2 of 3, target green.");
  });
});

describe("interrupted — the stop nobody chose", () => {
  it("reads as a warning that names what survived and what did not", () => {
    const v = driveVerdict(status({ phase: "interrupted", endedAt: "x", runs: [runRec()] }));
    expect(v.label).toBe("Interrupted");
    expect(v.tone).toBe("warn");
    expect(v.detail).toMatch(/commits stand/);
  });

  it("counts the CHAIN's runs, so a resumed drive does not read as if it had fresh rope", () => {
    const p = driveProgress(status({ runsBefore: 2, runs: [runRec()] }));
    expect(p.runsDone).toBe(3);
  });

  it("offers a resume only while the chain has rope left", () => {
    expect(driveResume(status({ phase: "interrupted", endedAt: "x", runsBefore: 1 }))).toEqual({
      runsDone: 1,
      runsLeft: 2,
      repos: 3,
    });
    expect(driveResume(status({ phase: "interrupted", endedAt: "x", runsBefore: 3 }))).toBeNull();
    expect(driveResume(status({ phase: "ceiling", endedAt: "x" }))).toBeNull();
  });
});

describe("lastDriveRunId", () => {
  it("is the run whose ledger the terminal view should show", () => {
    expect(lastDriveRunId(status({ runs: [runRec(), runRec({ runId: "run-2" })] }))).toBe("run-2");
  });

  it("is null for a drive that never dispatched one (already green)", () => {
    expect(lastDriveRunId(status({ phase: "green", runs: [] }))).toBeNull();
  });
});
