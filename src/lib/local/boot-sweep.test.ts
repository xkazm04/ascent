// The boot sweep's three contracts:
//   - it sweeps runs BEFORE drives (markStaleRunsStopped is what releases a dead lane's backlog
//     claims; a drive marked interrupted while its last run still looks alive is a half-truth);
//   - it is a no-op on a deployment that has no loop to sweep (managed cloud, or no database) —
//     "this process started nothing" is a claim about one instance, and on managed cloud there are
//     many;
//   - it runs once per process, so a dev-server reload re-entering register() cannot sweep twice.

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const env = { selfHosted: true, dbConfigured: true };

vi.mock("@/lib/env", () => ({ selfHosted: () => env.selfHosted }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => env.dbConfigured }));
vi.mock("@/lib/db/loop-runs", () => ({
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

import { bootSweepLine, sweepInterruptedWork } from "@/lib/local/boot-sweep";

beforeEach(() => {
  calls.length = 0;
  env.selfHosted = true;
  env.dbConfigured = true;
  delete (globalThis as unknown as Record<string, unknown>).__ascentBootSweepDone;
});

describe("sweepInterruptedWork", () => {
  it("reconciles runs first, then drives", async () => {
    const r = await sweepInterruptedWork();
    expect(calls).toEqual(["runs", "drives"]);
    expect(r).toEqual({ skipped: false, runs: 2, drives: 1 });
  });

  it("does not sweep a managed deployment — one instance cannot speak for the others", async () => {
    env.selfHosted = false;
    expect(await sweepInterruptedWork()).toEqual({ skipped: true, runs: 0, drives: 0 });
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
    expect(second).toEqual({ skipped: true, runs: 0, drives: 0 });
    expect(calls).toEqual(["runs", "drives"]);
  });
});

describe("bootSweepLine", () => {
  it("says nothing on a clean boot — a line every start trains the operator to ignore it", () => {
    expect(bootSweepLine({ skipped: false, runs: 0, drives: 0 })).toBeNull();
    expect(bootSweepLine({ skipped: true, runs: 0, drives: 0 })).toBeNull();
  });

  it("names both halves, singular and plural, when there was something to reconcile", () => {
    expect(bootSweepLine({ skipped: false, runs: 1, drives: 0 })).toContain("1 loop run stopped");
    expect(bootSweepLine({ skipped: false, runs: 2, drives: 1 })).toContain("2 loop runs stopped, 1 drive marked interrupted");
  });
});
