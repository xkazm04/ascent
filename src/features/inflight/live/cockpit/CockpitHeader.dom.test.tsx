/** @vitest-environment jsdom */

// THE WIND-DOWN THE OPERATOR CAN SEE (PRIYA-L2-C6). The measured defect: after Stop was pressed the
// run read `RUNNING` for 19m43s with an unchanged chip and a button that had already sprung back to
// "Stop" — *"an operator will press it again, or conclude it failed."* Both halves are pinned here:
// the label stays "Stopping…" for as long as the SERVER says the request is pending, and the caption
// names the horizon it is bounded by.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CockpitHeader } from "./CockpitHeader";
import { stoppingCaption, type LoopRunRecord } from "./loopTypes";

afterEach(cleanup);

const run = (o: Partial<LoopRunRecord> = {}): LoopRunRecord =>
  ({
    id: "run-1",
    orgId: "org-1",
    createdBy: null,
    phase: "running",
    repos: ["acme/web"],
    concurrency: 2,
    maxCycles: 3,
    cycle: 1,
    curated: false,
    targets: [],
    model: null,
    effort: null,
    modelPolicy: "single",
    models: [],
    delivery: null,
    batchSize: null,
    agentTimeoutMs: null,
    verifyMode: null,
    verifyTimeoutMs: null,
    startedAt: "2026-08-30T10:00:00.000Z",
    endedAt: null,
    error: null,
    createdAt: "2026-08-30T10:00:00.000Z",
    ...o,
  }) as LoopRunRecord;

const base = { fleetCount: 4, active: run(), laneCount: 1, live: true, wallHref: "?view=wall" };

describe("stoppingCaption", () => {
  it("names the horizon when there is one, and refuses to invent one when there is not", () => {
    expect(stoppingCaption(1_200_000)).toBe("Stopping — in-flight lanes finish their current session first, up to 20 min.");
    expect(stoppingCaption(5_400_000)).toContain("up to 90 min");
    // `null` is "we do not know", which is a different statement from "20 minutes" — and a wrong
    // bound is exactly the failure this caption exists to fix.
    expect(stoppingCaption(null)).toBe("Stopping — in-flight lanes finish their current session first.");
    expect(stoppingCaption(0)).not.toContain("up to");
  });
});

describe("CockpitHeader — a requested stop", () => {
  it("reverts to Stop only while nothing has been asked for", () => {
    render(<CockpitHeader {...base} onStop={() => {}} />);
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.queryByText(/Stopping —/)).toBeNull();
  });

  it("holds Stopping… and narrates the horizon for as long as the server says it is pending", () => {
    render(<CockpitHeader {...base} onStop={() => {}} stopRequested stopHorizonMs={1_200_000} />);
    const btn = screen.getByRole("button", { name: "Stopping…" });
    // Disabled so a second press cannot re-send a request that is already honoured.
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/up to 20 min/)).toBeTruthy();
  });

  it("says nothing about stopping once the run is no longer live", () => {
    render(<CockpitHeader {...base} live={false} active={null} stopRequested stopHorizonMs={1_200_000} />);
    expect(screen.queryByText(/Stopping —/)).toBeNull();
  });
});
