// @vitest-environment jsdom
//
// The cockpit's poll contract, which is the one piece of it that can burn a laptop if it is wrong:
//   - a cockpit with nothing running arms NO timer at all;
//   - a live run polls status AND the active run's lanes on the same tick;
//   - the run FINISHING (the active id disappearing) fetches the final detail exactly once and hands
//     it up — that final read is what the outcome ledger and the field's drift are both built from.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLoopRun } from "./useLoopRun";
import type { LoopRunRecord } from "./loopTypes";

const run = (o: Partial<LoopRunRecord> = {}): LoopRunRecord => ({
  id: "run-1",
  orgId: "org-1",
  createdBy: "kaz",
  phase: "running",
  repos: ["acme/one"],
  concurrency: 2,
  maxCycles: 3,
  cycle: 1,
  curated: false,
  startedAt: "2026-08-22T10:00:00Z",
  endedAt: null,
  error: null,
  createdAt: "2026-08-22T10:00:00Z",
  ...o,
});

const detailFor = (id: string) => ({
  run: run({ id, phase: "done", endedAt: "2026-08-22T10:20:00Z" }),
  lanes: [{ id: "lane-1", runId: id, repoFullName: "acme/one", phase: "done", stage: null, log: [], closedIds: [], batchIds: [], commits: 2, branch: "ascent/loop", beforeScanId: "b", afterScanId: "a", error: null, startedAt: null, endedAt: null }],
  outcomes: [],
});

/** Queue of status payloads; each GET /api/org/loop pops the next (last one repeats). */
let statuses: unknown[] = [];
let calls: string[] = [];

function install() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.startsWith("/api/org/loop?")) {
        const next = statuses.length > 1 ? statuses.shift() : statuses[0];
        return { ok: true, json: async () => next } as Response;
      }
      const id = url.split("/api/org/loop/")[1]!.split("?")[0]!;
      return { ok: true, json: async () => detailFor(decodeURIComponent(id)) } as Response;
    }),
  );
}

beforeEach(() => {
  calls = [];
  install();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const base = { slug: "acme", initialRuns: [], initialEnabled: true };

describe("useLoopRun", () => {
  it("ticks once on mount and then arms NO timer while nothing is running", async () => {
    statuses = [{ enabled: true, active: null, runs: [] }];
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useLoopRun({ ...base, initialActive: null }));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(result.current.live).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(calls).toHaveLength(1);
  });

  it("polls status AND the active run's detail on every tick while live", async () => {
    statuses = [{ enabled: true, active: run(), runs: [] }];
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useLoopRun({ ...base, initialActive: run() }));
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    expect(calls.filter((c) => c.startsWith("/api/org/loop?"))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith("/api/org/loop/run-1"))).toHaveLength(1);
    expect(result.current.live).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    await waitFor(() => expect(calls.filter((c) => c.startsWith("/api/org/loop?")).length).toBeGreaterThanOrEqual(2));
  });

  it("settles ONCE with the final detail when the active run disappears", async () => {
    statuses = [
      { enabled: true, active: run(), runs: [] },
      { enabled: true, active: null, runs: [{ id: "run-1", phase: "done", repos: ["acme/one"], cycle: 1, maxCycles: 3, startedAt: "x", endedAt: "y", lift: 4 }] },
    ];
    const onSettled = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderHook(() => useLoopRun({ ...base, initialActive: run(), onSettled }));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(onSettled.mock.calls[0]![0].run.id).toBe("run-1");

    // The timer is gone with the run, so no further tick can settle it a second time.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's own message instead of a generic failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: "Set ASCENT_AUTOPILOT=1." }) }) as Response));
    const { result } = renderHook(() => useLoopRun({ ...base, initialActive: null }));
    await waitFor(() => expect(result.current.error).toBe("Set ASCENT_AUTOPILOT=1."));
  });
});
