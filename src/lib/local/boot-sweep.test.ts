// The boot sweep's four contracts:
//   - it sweeps runs BEFORE drives (markStaleRunsStopped is what releases a dead lane's backlog
//     claims; a drive marked interrupted while its last run still looks alive is a half-truth);
//   - it reads the in-flight LANES before either, because that read is only possible while their runs
//     still say `running` — and it is what lets the filesystem half know which worktrees it stopped;
//   - it is a no-op on a deployment that has no loop to sweep (managed cloud, or no database) —
//     "this process started nothing" is a claim about one instance, and on managed cloud there are
//     many;
//   - it runs once per process, so a dev-server reload re-entering register() cannot sweep twice.

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const env = { selfHosted: true, dbConfigured: true };
const inFlight = [{ runId: "run-1", orgSlug: "acme", repoFullName: "acme/api", branch: "ascent/loop-1-acme-api" }];
const swept: unknown[] = [];

vi.mock("@/lib/env", () => ({ selfHosted: () => env.selfHosted }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => env.dbConfigured }));
vi.mock("@/lib/db/loop-runs", () => ({
  listInFlightLanes: vi.fn(async () => {
    calls.push("lanes");
    return inFlight;
  }),
  markStaleRunsStopped: vi.fn(async () => {
    calls.push("runs");
    return 2;
  }),
}));
vi.mock("@/lib/db/drives", () => ({
  markStaleDrivesInterrupted: vi.fn(async () => {
    calls.push("drives");
    return 1;
  }),
}));
vi.mock("@/lib/db/org-local", () => ({ getRepoLocalPath: vi.fn(async () => "/paired/acme/api") }));
vi.mock("@/lib/local/loop-worktree", () => ({
  removeStrandedWorktrees: vi.fn(async (lanes: unknown[]) => {
    calls.push("worktrees");
    swept.push(...lanes);
    return ["C:/tmp/ascent-loop-abc"];
  }),
}));

import { bootSweepLine, sweepInterruptedWork } from "@/lib/local/boot-sweep";

beforeEach(() => {
  calls.length = 0;
  swept.length = 0;
  env.selfHosted = true;
  env.dbConfigured = true;
  delete (globalThis as unknown as Record<string, unknown>).__ascentBootSweepDone;
});

describe("sweepInterruptedWork", () => {
  it("reads the in-flight lanes first, then reconciles runs, then drives, then the filesystem", async () => {
    const r = await sweepInterruptedWork();
    // The ORDER is the contract. `markStaleRunsStopped` is what makes these runs stopped, so reading
    // their lanes afterwards would find nothing distinguishing them from a run that errored last week.
    expect(calls).toEqual(["lanes", "runs", "drives", "worktrees"]);
    expect(r).toEqual({ skipped: false, runs: 2, drives: 1, worktrees: 1 });
  });

  it("hands the filesystem sweep exactly the lanes whose runs it just stopped", async () => {
    await sweepInterruptedWork();
    expect(swept).toEqual(inFlight);
  });

  it("does not sweep a managed deployment — one instance cannot speak for the others", async () => {
    env.selfHosted = false;
    expect(await sweepInterruptedWork()).toEqual({ skipped: true, runs: 0, drives: 0, worktrees: 0 });
    expect(calls).toEqual([]);
  });

  it("does not sweep without a database", async () => {
    env.dbConfigured = false;
    expect((await sweepInterruptedWork()).skipped).toBe(true);
    expect(calls).toEqual([]);
  });

  it("runs once per process — a hot reload re-entering register() sweeps nothing twice", async () => {
    await sweepInterruptedWork();
    const second = await sweepInterruptedWork();
    expect(second).toEqual({ skipped: true, runs: 0, drives: 0, worktrees: 0 });
    expect(calls).toEqual(["lanes", "runs", "drives", "worktrees"]);
  });
});

describe("bootSweepLine", () => {
  it("says nothing on a clean boot — a line every start trains the operator to ignore it", () => {
    expect(bootSweepLine({ skipped: false, runs: 0, drives: 0, worktrees: 0 })).toBeNull();
    expect(bootSweepLine({ skipped: true, runs: 0, drives: 0, worktrees: 0 })).toBeNull();
  });

  it("names every half, singular and plural, when there was something to reconcile", () => {
    expect(bootSweepLine({ skipped: false, runs: 1, drives: 0, worktrees: 0 })).toContain("1 loop run stopped");
    expect(bootSweepLine({ skipped: false, runs: 2, drives: 1, worktrees: 0 })).toContain(
      "2 loop runs stopped, 1 drive marked interrupted",
    );
    expect(bootSweepLine({ skipped: false, runs: 1, drives: 0, worktrees: 3 })).toContain("3 stranded worktrees removed");
    expect(bootSweepLine({ skipped: false, runs: 0, drives: 0, worktrees: 1 })).toContain("1 stranded worktree removed");
  });
});
