// RESUME CONTINUES THE COUNT. The one rule that makes resuming safe: the run budget belongs to the
// CHAIN, not to a segment of it. If a restart re-granted the whole rope, "a bounded drive, never an
// open-ended agent" would be one crash away from false — and a crash is exactly when it is easiest
// not to notice.
//
// Both functions are pure and live in drive-types.ts (no db, no engine, no selfHosted()), so this is
// the same code the server's `resumeDrive` and the cockpit's resume button consult.

import { describe, expect, it } from "vitest";
import { driveRunsDone, resumeParams, type DriveRunRecord, type DriveStatus } from "@/lib/local/drive-types";

const run = (id: string, ended: boolean): DriveRunRecord => ({
  runId: id,
  repos: ["acme/a"],
  debtBefore: 100,
  debtAfter: ended ? 60 : null,
  startedAt: "t0",
  endedAt: ended ? "t1" : null,
});

const drive = (over: Partial<DriveStatus> = {}): DriveStatus => ({
  id: "drive_1",
  org: "acme",
  phase: "interrupted",
  repos: ["acme/a", "acme/b"],
  maxRuns: 3,
  maxCycles: 3,
  concurrency: 2,
  runs: [],
  measurement: null,
  runsBefore: 0,
  resumedFrom: null,
  startedAt: "2026-08-28T10:00:00.000Z",
  endedAt: "2026-08-28T11:00:00.000Z",
  error: null,
  stopRequested: false,
  ...over,
});

describe("driveRunsDone — the chain's count", () => {
  it("counts finished runs, not dispatched ones (an unmeasured run has decided nothing)", () => {
    expect(driveRunsDone(drive({ runs: [run("a", true), run("b", false)] }))).toBe(1);
  });

  it("adds the runs the chain inherited", () => {
    expect(driveRunsDone(drive({ runsBefore: 2, runs: [run("a", true)] }))).toBe(3);
  });
});

describe("resumeParams — continuing, not restarting", () => {
  it("hands the new drive the runs already spent, so the cap spans the chain", () => {
    const params = resumeParams(drive({ runs: [run("a", true), run("b", true)] }));
    expect(params).toMatchObject({ org: "acme", maxRuns: 3, runsBefore: 2, resumedFrom: "drive_1" });
  });

  it("accumulates across a chain of resumes rather than resetting each time", () => {
    // drive_2 already resumed drive_1 (2 runs) and then ran one more before being interrupted again.
    const params = resumeParams(drive({ id: "drive_2", maxRuns: 5, runsBefore: 2, runs: [run("c", true)] }));
    expect(params?.runsBefore).toBe(3);
    expect(params?.resumedFrom).toBe("drive_2");
  });

  it("carries the scope and the bounds unchanged — a resume is the same drive, not a new brief", () => {
    const params = resumeParams(drive({ repos: ["acme/x"], maxCycles: 5, concurrency: 4, runs: [run("a", true)] }));
    expect(params).toMatchObject({ repos: ["acme/x"], maxCycles: 5, concurrency: 4 });
  });

  it("refuses when the chain has already spent the whole budget", () => {
    expect(resumeParams(drive({ maxRuns: 2, runs: [run("a", true), run("b", true)] }))).toBeNull();
    expect(resumeParams(drive({ maxRuns: 3, runsBefore: 3 }))).toBeNull();
  });

  it("refuses every phase but interrupted — a drive that stopped for a reason is not resumable", () => {
    for (const phase of ["running", "green", "dry", "ceiling", "stopped", "error"] as const) {
      expect(resumeParams(drive({ phase }))).toBeNull();
    }
  });
});
