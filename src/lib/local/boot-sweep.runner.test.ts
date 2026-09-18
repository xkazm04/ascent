// THE BOOT SWEEP AND THE STANDING RUNNER — the one exception to "reconcile, never resume".
//
// A continuous drive whose row still says running / paused / idle is RE-ATTACHED on its same row
// (operator decision, 2026-09-18) — but only on a self-hosted deployment with the loop switched on. A
// bounded drive in the same sweep is still `interrupted`, and resuming it is still a human's click.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveStatus } from "./drive-types";

const env = { autopilot: true, reattachThrows: false };
const interrupted: string[] = [];
const marked: { id: string; reason: string }[] = [];
const resumedWith: unknown[] = [];

const row = (id: string, mode: "bounded" | "continuous"): DriveStatus =>
  ({ id, org: "acme", phase: "running", mode, repos: ["acme/api"], runs: [], stopRequested: false }) as unknown as DriveStatus;

vi.mock("@/lib/env", () => ({ selfHosted: () => true }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true }));
vi.mock("@/lib/db/loop-runs", () => ({
  listInFlightLanes: vi.fn(async () => []),
  markStaleRunsStopped: vi.fn(async () => 1),
}));
vi.mock("@/lib/db/drives", () => ({
  DRIVE_INTERRUPTED_REASON: "generic restart reason",
  RUNNER_AUTOPILOT_OFF_REASON: "loop off reason",
  // The DB holds one continuous and one bounded drive, both left `running` by the dead process.
  listRunnerDrivesToResume: vi.fn(async () => [{ drive: row("drive-runner", "continuous"), createdBy: "octocat" }]),
  markStaleDrivesInterrupted: vi.fn(async (_org: unknown, isLive: (id: string) => boolean) => {
    const stale = ["drive-runner", "drive-bounded"].filter((id) => !isLive(id) && !marked.some((m) => m.id === id));
    interrupted.push(...stale);
    return stale.length;
  }),
  markDriveInterrupted: vi.fn(async (id: string, reason: string) => {
    marked.push({ id, reason });
    return true;
  }),
}));
vi.mock("@/lib/db/org-local", () => ({ getRepoLocalPath: vi.fn(async () => null) }));
vi.mock("@/lib/local/loop-worktree", () => ({ removeStrandedWorktrees: vi.fn(async () => []) }));
vi.mock("@/lib/local/agent", () => ({ autopilotEnabled: () => env.autopilot }));
vi.mock("@/lib/local/runner-control", () => ({
  resumeRunnerDrives: vi.fn((rows: { drive: DriveStatus }[]) => {
    if (env.reattachThrows) throw new Error("engine failed to load");
    resumedWith.push(...rows);
    return rows.map((r) => r.drive.id);
  }),
}));

import { bootSweepLine, sweepInterruptedWork } from "./boot-sweep";

beforeEach(() => {
  env.autopilot = true;
  env.reattachThrows = false;
  interrupted.length = 0;
  marked.length = 0;
  resumedWith.length = 0;
  delete (globalThis as unknown as Record<string, unknown>).__ascentBootSweepDone;
});

describe("sweepInterruptedWork — the standing runner", () => {
  it("re-attaches a continuous `running` drive on its SAME row; a bounded one is still interrupted", async () => {
    const r = await sweepInterruptedWork();
    expect(resumedWith).toEqual([{ drive: expect.objectContaining({ id: "drive-runner" }), createdBy: "octocat" }]);
    expect(interrupted).toEqual(["drive-bounded"]);
    expect(marked).toEqual([]);
    expect(r).toEqual({ skipped: false, runs: 1, drives: 1, worktrees: 0, resumed: 1 });
    expect(bootSweepLine(r)).toContain("1 standing runner resumed");
  });

  it("with the loop OFF at boot the runner is interrupted — with that reason — and nothing is re-armed", async () => {
    env.autopilot = false;
    const r = await sweepInterruptedWork();
    expect(resumedWith).toEqual([]);
    expect(marked).toEqual([{ id: "drive-runner", reason: "loop off reason" }]);
    expect(interrupted).toEqual(["drive-bounded"]);
    expect(r).toMatchObject({ drives: 2, resumed: 0 });
  });

  it("a runner that could not be re-attached is interrupted after all — never left `running` with no driver", async () => {
    env.reattachThrows = true;
    const r = await sweepInterruptedWork();
    expect(marked).toEqual([{ id: "drive-runner", reason: "generic restart reason" }]);
    expect(r).toMatchObject({ drives: 2, resumed: 0 });
  });
});
