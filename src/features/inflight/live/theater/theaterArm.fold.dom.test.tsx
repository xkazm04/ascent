// @vitest-environment jsdom
//
// THE ARM LABEL ALONG THE WHOLE PULSE PATH — db-shaped rows → `foldLoopPulse` → the JSON the route
// serves → `TheaterShell` → the label on screen.
//
// A component test proves the header CAN render an arm; it cannot prove the running app ever hands it
// one, and for a day it did not: `LanePulse` carried no arm at all, so the label rendered nothing on
// every real screen while its own test stayed green. The fold is therefore in this test's path on
// purpose — a field only exists if the thing that feeds it populates it.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEATER_PULSE_MS } from "@/lib/local/runner-types";
import { foldLoopPulse, type PulseLaneRow, type PulseRunRow } from "@/lib/db/loop-pulse-fold";

vi.mock("./theaterSound", () => ({ playCue: vi.fn(), unlockAudio: vi.fn(() => true), lockAudio: vi.fn() }));

const { TheaterShell } = await import("./TheaterShell");

const NOW = new Date("2026-09-18T12:00:00.000Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

const ARMS = [
  { id: "claude-1", label: "Claude", transport: "claude", model: "sonnet" },
  { id: "local-2", label: "claude:sonnet plan → pi:qwen3.8:27b", transport: "pi", model: "qwen3.8:27b", plan: { transport: "claude", model: "sonnet" } },
];

/** One lane of the run, exactly the columns `LANE_SELECT` reads. */
const laneRow = (armId: string | null): PulseLaneRow => ({
  id: "lane-1",
  repoFullName: "acme/kp",
  cycle: 1,
  phase: "running",
  stage: "agent",
  stageAt: ago(3),
  heartbeatAt: ago(1),
  startedAt: ago(9),
  deadlineAt: new Date(NOW.getTime() + 600_000),
  activityJson: JSON.stringify([{ at: ago(1).toISOString(), kind: "edit", path: "src/a.ts", tool: "Edit", note: null }]),
  diffStatJson: null,
  turns: 3,
  costMicros: null,
  planId: null,
  commits: 0,
  armId,
});

const runRow = (armId: string | null, armsJson: string | null): PulseRunRow => ({
  id: "run-1",
  seq: 14,
  phase: "running",
  cycle: 1,
  maxCycles: 3,
  startedAt: ago(20),
  reposJson: JSON.stringify(["acme/kp"]),
  armsJson,
  lanes: [laneRow(armId)],
});

const served = (armId: string | null, armsJson: string | null) =>
  foldLoopPulse({
    org: "acme",
    now: NOW,
    midnight: new Date("2026-09-18T00:00:00.000Z"),
    run: runRow(armId, armsJson),
    heldLaneIds: new Set<string>(),
    drive: null,
    pendingPlanCount: 0,
    pendingPlans: [],
    recentLanes: [],
    spendTodayMicros: 0,
  });

/** The pulse as the route actually sends it: over the wire, through JSON. */
const serve = (pulse: unknown) => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(pulse)) }) as Response));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe("the arm label, from the fold to the screen", () => {
  it("names the arm the working lane is a sample of", async () => {
    serve(served("local-2", JSON.stringify(ARMS)));
    render(<TheaterShell source={{ kind: "org", slug: "acme" }} />);
    await advance(THEATER_PULSE_MS);
    expect(screen.getByTestId("theater-arm")).toHaveTextContent("claude:sonnet plan → pi:qwen3.8:27b");
  });

  it("renders NOTHING — never 'default' — for a lane recorded before arms existed", async () => {
    serve(served(null, null));
    render(<TheaterShell source={{ kind: "org", slug: "acme" }} />);
    await advance(THEATER_PULSE_MS);
    // The lane is on screen, so this is a rendered header with no arm — not an empty page.
    expect(screen.getAllByText(/kp/).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("theater-arm")).not.toBeInTheDocument();
    expect(screen.queryByText(/default/i)).not.toBeInTheDocument();
  });

  it("renders nothing for an armId that names no arm of its run, rather than guessing the first", async () => {
    serve(served("gone-9", JSON.stringify(ARMS)));
    render(<TheaterShell source={{ kind: "org", slug: "acme" }} />);
    await advance(THEATER_PULSE_MS);
    expect(screen.queryByTestId("theater-arm")).not.toBeInTheDocument();
  });
});
