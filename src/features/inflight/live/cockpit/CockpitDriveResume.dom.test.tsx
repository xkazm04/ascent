// @vitest-environment jsdom
//
// The interrupted panel's job is to be honest about three things at once: the drive stopped, nothing
// resumed it on your behalf, and what the runs it DID finish are still worth. The test pins the third
// especially — the failure mode this replaces is a restart that reported nothing at all.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CockpitDriveResume } from "./CockpitDriveResume";
import type { DriveRunRecord, DriveStatus } from "./driveTypes";

const run = (id: string): DriveRunRecord => ({
  runId: id,
  repos: ["acme/a"],
  debtBefore: 100,
  debtAfter: 60,
  startedAt: "t0",
  endedAt: "t1",
});

const drive = (over: Partial<DriveStatus> = {}): DriveStatus => ({
  id: "drive_1",
  org: "acme",
  phase: "interrupted",
  repos: ["acme/a", "acme/b"],
  maxRuns: 3,
  maxCycles: 3,
  concurrency: 2,
  runs: [run("run-1")],
  measurement: { debt: 60, green: false, greenCount: 0, inScope: 2, remaining: ["acme/a"], unscanned: [] },
  runsBefore: 0,
  resumedFrom: null,
  startedAt: "2026-08-28T10:00:00.000Z",
  endedAt: "2026-08-28T11:00:00.000Z",
  error: null,
  stopRequested: false,
  ...over,
});

const noop = () => {};

describe("CockpitDriveResume", () => {
  it("names the interruption and says the finished runs stand", () => {
    render(<CockpitDriveResume drive={drive()} onResume={noop} onDismiss={noop} />);
    expect(screen.getByTestId("drive-interrupted")).toBeTruthy();
    expect(screen.getByText(/Drive · Interrupted/)).toBeTruthy();
    expect(screen.getByText(/Those runs and their commits stand/)).toBeTruthy();
    expect(screen.getByText(/not resumed on its own/)).toBeTruthy();
  });

  it("shows the rope spent by the CHAIN and the rope left", () => {
    render(<CockpitDriveResume drive={drive({ runsBefore: 1 })} onResume={noop} onDismiss={noop} />);
    expect(screen.getByText("2/3 runs spent")).toBeTruthy();
    expect(screen.getByTestId("drive-resume").textContent).toContain("1 run left");
  });

  it("resumes on one click", () => {
    const onResume = vi.fn();
    render(<CockpitDriveResume drive={drive()} onResume={onResume} onDismiss={noop} />);
    fireEvent.click(screen.getByTestId("drive-resume"));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("offers no resume when the chain already spent its budget — the button would only 409", () => {
    render(<CockpitDriveResume drive={drive({ maxRuns: 1 })} onResume={noop} onDismiss={noop} />);
    expect(screen.queryByTestId("drive-resume")).toBeNull();
    expect(screen.getByText(/run budget is spent/)).toBeTruthy();
  });

  it("disables the button while a resume is in flight, so a double click cannot arm two drives", () => {
    render(<CockpitDriveResume drive={drive()} onResume={noop} onDismiss={noop} busy />);
    expect((screen.getByTestId("drive-resume") as HTMLButtonElement).disabled).toBe(true);
  });

  it("is dismissible — an offer, not a modal", () => {
    const onDismiss = vi.fn();
    render(<CockpitDriveResume drive={drive()} onResume={noop} onDismiss={onDismiss} error="A drive is already running." />);
    expect(screen.getByText("A drive is already running.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("drive-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
