// @vitest-environment jsdom
//
// The drive control's states, in the order an operator meets them:
//   - just started: no run measured yet, so it says it is measuring rather than claiming 0% progress;
//   - pulling: run counter against the cap, falling debt, the in-flight run's own lane count, Stop;
//   - stop pressed: the button says it will finish this run first, and cannot be pressed twice;
//   - terminal: the verdict banner naming WHICH of the honest stops ended it.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CockpitDrivePanel, DriveVerdict } from "./CockpitDrivePanel";
import type { DriveMeasurement, DriveRunRecord, DriveStatus } from "./driveTypes";
import type { LoopRunDetail } from "./loopTypes";

const measure = (over: Partial<DriveMeasurement> = {}): DriveMeasurement => ({
  debt: 80,
  green: false,
  greenCount: 1,
  inScope: 3,
  remaining: ["acme/a", "acme/b"],
  unscanned: [],
  ...over,
});

const runRec = (over: Partial<DriveRunRecord> = {}): DriveRunRecord => ({
  runId: "run-1",
  repos: ["acme/a", "acme/b"],
  debtBefore: 120,
  debtAfter: 80,
  startedAt: "2026-08-28T10:00:00Z",
  endedAt: "2026-08-28T10:20:00Z",
  ...over,
});

const drive = (over: Partial<DriveStatus> = {}): DriveStatus => ({
  id: "drive_1",
  org: "acme",
  phase: "running",
  repos: ["acme/a", "acme/b", "acme/c"],
  maxRuns: 3,
  maxCycles: 3,
  concurrency: 2,
  runs: [],
  measurement: measure(),
  startedAt: "2026-08-28T10:00:00Z",
  endedAt: null,
  error: null,
  stopRequested: false,
  ...over,
});

const detail = (id: string, done: number, total: number): LoopRunDetail =>
  ({
    run: { id, phase: "running", cycle: 2, maxCycles: 3 },
    lanes: Array.from({ length: total }, (_, i) => ({ id: `lane-${i}`, phase: i < done ? "done" : "dispatching" })),
    outcomes: [],
  }) as unknown as LoopRunDetail;

describe("CockpitDrivePanel", () => {
  it("says it is measuring instead of claiming progress it has not made", () => {
    render(<CockpitDrivePanel drive={drive({ measurement: null })} runDetail={null} onStop={vi.fn()} />);
    expect(screen.getByText(/Measuring the fleet/)).toBeInTheDocument();
    expect(screen.getByText("No run dispatched yet.")).toBeInTheDocument();
    expect(screen.getByText("run 0/3")).toBeInTheDocument();
  });

  it("counts the in-flight run against the cap and shows debt falling from where it started", () => {
    const open = runRec({ runId: "run-2", debtBefore: 80, debtAfter: null, endedAt: null });
    render(
      <CockpitDrivePanel
        drive={drive({ runs: [runRec(), open] })}
        runDetail={detail("run-2", 1, 2)}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText("run 2/3")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("-40 from 120")).toBeInTheDocument();
    expect(screen.getByText(/1\/3 green/)).toBeInTheDocument();
    // The run's own detail — the per-second question during a drive.
    expect(screen.getByText(/cycle 2\/3 · 1\/2 lanes done/)).toBeInTheDocument();
    // The finished run's ledger row, and the open one refusing to report a number it does not have.
    expect(screen.getByText("120 → 80")).toBeInTheDocument();
    expect(screen.getByText("in flight")).toBeInTheDocument();
  });

  it("says so between runs rather than looking stalled", () => {
    render(<CockpitDrivePanel drive={drive({ runs: [runRec()] })} runDetail={null} onStop={vi.fn()} />);
    expect(screen.getByText(/Re-scoring the fleet before the next run/)).toBeInTheDocument();
  });

  it("offers Stop while pulling, and promises to finish the run first once pressed", () => {
    const onStop = vi.fn();
    const { rerender } = render(<CockpitDrivePanel drive={drive({ runs: [runRec()] })} runDetail={null} onStop={onStop} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop drive" }));
    expect(onStop).toHaveBeenCalledOnce();

    rerender(<CockpitDrivePanel drive={drive({ runs: [runRec()], stopRequested: true })} runDetail={null} onStop={onStop} />);
    expect(screen.getByRole("button", { name: "Stopping after this run…" })).toBeDisabled();
  });

  it("withdraws Stop the moment the drive is no longer live", () => {
    render(<CockpitDrivePanel drive={drive({ phase: "green", endedAt: "2026-08-28T11:00:00Z" })} runDetail={null} onStop={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Stop/ })).not.toBeInTheDocument();
  });

  it("surfaces the engine's own failure and the client's own", () => {
    render(<CockpitDrivePanel drive={drive({ error: "Nothing to drive." })} runDetail={null} onStop={vi.fn()} error="Network error." />);
    expect(screen.getByText("Nothing to drive.")).toBeInTheDocument();
    expect(screen.getByText("Network error.")).toBeInTheDocument();
  });
});

describe("DriveVerdict", () => {
  const ended = (phase: DriveStatus["phase"], over: Partial<DriveStatus> = {}) =>
    drive({ phase, endedAt: "2026-08-28T11:00:00Z", runs: [runRec(), runRec({ runId: "run-2" })], ...over });

  it("names green as the target reached", () => {
    render(<DriveVerdict drive={ended("green", { measurement: measure({ green: true, debt: 0, greenCount: 3, remaining: [] }) })} />);
    expect(screen.getByText("Drive · Green")).toBeInTheDocument();
    expect(screen.getByText("2/3 runs · 3/3 green")).toBeInTheDocument();
  });

  it("distinguishes a stalled agent from a spent budget", () => {
    const { unmount } = render(<DriveVerdict drive={ended("dry")} />);
    expect(screen.getByText(/moved nothing/)).toBeInTheDocument();
    unmount();
    render(<DriveVerdict drive={ended("ceiling")} />);
    expect(screen.getByText(/Raise the run budget/)).toBeInTheDocument();
  });

  it("offers the way back only when there is no run ledger under it", () => {
    const onBack = vi.fn();
    const { rerender } = render(<DriveVerdict drive={ended("green")} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to inspect" }));
    expect(onBack).toHaveBeenCalledOnce();
    rerender(<DriveVerdict drive={ended("green")} />);
    expect(screen.queryByRole("button", { name: "Back to inspect" })).not.toBeInTheDocument();
  });
});
