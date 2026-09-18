// @vitest-environment jsdom
//
// THE DRIVE PANEL SHOWS ITS IN-FLIGHT RUN (2026-09-18). A drive dispatches each run SERVER-side, so
// this tab started none of them — and the loop poll only ever ticked for a run the tab knew about.
// `CockpitDrivePanel`'s `inFlight` therefore stayed null and the panel read "Re-scoring the fleet
// before the next run…" for the entire drive. Pinned through the REAL composition: `useCockpit`
// (useLoopRun + useDrive) feeding `CockpitRail` exactly as LiveCockpit wires it, over a fetch stub.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { CockpitRail } from "./CockpitRail";
import { useCockpit } from "./useCockpit";
import { IDLE_DISCOVERY_MS } from "./useLoopRun";
import type { DriveStatus } from "./driveTypes";
import type { LoopRunRecord } from "./loopTypes";

const run = (): LoopRunRecord =>
  ({ id: "run-7", orgId: "o", createdBy: "kaz", phase: "running", repos: ["acme/a"], concurrency: 2, maxCycles: 3, cycle: 1,
    curated: false, startedAt: "2026-09-18T10:00:00Z", endedAt: null, error: null, createdAt: "2026-09-18T10:00:00Z" }) as LoopRunRecord;

const driveStatus = (dispatched: boolean): DriveStatus => ({
  id: "drive_1", org: "acme", phase: "running", repos: ["acme/a"], maxRuns: 3, maxCycles: 3, concurrency: 2,
  runs: dispatched ? [{ runId: "run-7", repos: ["acme/a"], debtBefore: 80, debtAfter: null, startedAt: "2026-09-18T10:00:00Z", endedAt: null }] : [],
  measurement: { debt: 80, green: false, greenCount: 0, inScope: 1, remaining: ["acme/a"], unscanned: [] },
  runsBefore: 0, resumedFrom: null, startedAt: "2026-09-18T09:59:00Z", endedAt: null, error: null, stopRequested: false,
});

const lane = (id: string, phase: string) => ({ id, runId: "run-7", repoFullName: "acme/a", cycle: 1, phase, stage: null, log: [], batchIds: [], closedIds: [], commits: 0, branch: null, beforeScanId: null, afterScanId: null, error: null, startedAt: null, endedAt: null, deliverables: [] });

/** The server, as this tab sees it: has the drive dispatched its first run yet? Is there a drive? */
let dispatched = false;
let driving = true;
let calls: string[] = [];

beforeEach(() => {
  dispatched = false;
  driving = true;
  calls = [];
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      const body = url.startsWith("/api/org/local/drive")
        ? { enabled: true, drives: driving ? [driveStatus(dispatched)] : [] }
        : url.startsWith("/api/org/loop?")
          ? { enabled: true, active: dispatched ? run() : null, runs: [] }
          : url.startsWith("/api/org/loop/run-7")
            ? { run: run(), lanes: [lane("l1", "done"), lane("l2", "dispatching")], outcomes: [], itemOutcomes: [] }
            : { proposals: [] };
      return { ok: true, json: async () => body } as Response;
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Harness() {
  const c = useCockpit({
    slug: "acme",
    seeds: [{ fullName: "acme/a", name: "a", overall: 60, adoption: 60, rigor: 60, level: "L3", posture: null }],
    histories: [],
    pairedRepos: ["acme/a"],
    activeRun: null,
    runs: [],
    loopEnabled: true,
    selfHosted: true,
    isOwner: true,
  });
  const noop = () => undefined;
  return (
    <CockpitRail
      slug="acme" mode={c.mode === "outcome" ? "inspect" : c.mode} setup={c.setup} liveDrive={c.drive.live ? c.drive.drive : null}
      interruptedDrive={c.interruptedDrive} runDetail={c.loop.detail} runLive={c.loop.live} batch={c.batch} dials={c.dials}
      canRun busy={false} loopError={null} driveError={null} onRun={noop} onDrive={noop} onStopRun={noop} onStopDrive={noop}
      onResumeDrive={noop} onDismissDrive={noop} onRetryLane={noop}
    />
  );
}

/** Time passes in small `act` steps: React flushes effects when an `act` scope exits, and the
 *  cockpit's hand-offs (drive poll → loop refresh → detail) each go through an effect. */
async function advance(ms: number, step = 250) {
  for (let t = 0; t < ms; t += step) await act(async () => void (await vi.advanceTimersByTimeAsync(Math.min(step, ms - t))));
}

describe("useCockpit — a drive's runs reach the drive panel", () => {
  it("renders the in-flight run's lanes as soon as the drive reports the run it dispatched", async () => {
    render(<Harness />);
    await advance(1_000);
    // Measuring, nothing dispatched: the honest between-runs line.
    expect(screen.getByText(/Re-scoring the fleet before the next run/)).toBeInTheDocument();

    dispatched = true; // the drive dispatches run-7 server-side — this tab did not start it
    const loopReads = () => calls.filter((c) => c.startsWith("/api/org/loop?")).length;
    const before = loopReads();
    await advance(10_500); // t ≈ 11.5 s: no drive poll since, and the loop's idle tick is not due
    expect(loopReads()).toBe(before);
    expect(screen.getByText(/Re-scoring the fleet before the next run/)).toBeInTheDocument();

    await advance(1_500); // t ≈ 13 s: the drive's own 12-second poll reports the new in-flight run…
    // …and the loop hook is told to look NOW, not at its 20-second idle discovery.
    expect(13_000).toBeLessThan(IDLE_DISCOVERY_MS);
    expect(loopReads()).toBe(before + 1);
    expect(screen.getByText(/cycle 1\/3 · 1\/2 lanes done/)).toBeInTheDocument();
    expect(screen.queryByText(/Re-scoring the fleet/)).not.toBeInTheDocument();
    expect(calls.some((c) => c.startsWith("/api/org/loop/run-7"))).toBe(true);
  });

  it("shows a run another tab started as the run it is, once idle discovery finds it", async () => {
    driving = false;
    render(<Harness />);
    await advance(1_000);
    expect(screen.getByText("Inspector")).toBeInTheDocument();
    dispatched = true; // started elsewhere — no drive, no click in this tab
    await advance(IDLE_DISCOVERY_MS);
    expect(screen.getByText("Run · running")).toBeInTheDocument();
    expect(screen.getByText(/cycle 1\/3 · 1\/2 lanes done/)).toBeInTheDocument();
  });
});
