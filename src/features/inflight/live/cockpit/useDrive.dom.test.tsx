// @vitest-environment jsdom
//
// The drive hook's two contracts:
//   - GATING: when the cockpit cannot dispatch, the hook makes no request at all. The route 404s on
//     managed cloud by design, and a panel that has never been offered has no business asking.
//   - POLL DISCIPLINE, same as useLoopRun: no idle timer, a tick only while a drive is live, and the
//     terminal status handed up EXACTLY once — that hand-off is what puts the verdict on screen.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDrive } from "./useDrive";
import type { DriveStatus } from "./driveTypes";

const drive = (over: Partial<DriveStatus> = {}): DriveStatus => ({
  id: "drive_1",
  org: "acme",
  phase: "running",
  repos: ["acme/a"],
  maxRuns: 3,
  maxCycles: 3,
  concurrency: 2,
  runs: [],
  measurement: null,
  startedAt: "2026-08-28T10:00:00Z",
  endedAt: null,
  error: null,
  stopRequested: false,
  ...over,
});

/** Queue of GET payloads; each read pops the next (the last one repeats). */
let payloads: unknown[] = [];
let calls: string[] = [];

function install() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if ((init?.method ?? "GET") === "GET") {
        const next = payloads.length > 1 ? payloads.shift() : payloads[0];
        return { ok: true, json: async () => next } as Response;
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { action?: string };
      if (body.action === "start") return { ok: true, json: async () => ({ drive: drive() }) } as Response;
      return { ok: true, json: async () => ({ ok: true, drive: drive({ stopRequested: true }) }) } as Response;
    }),
  );
}

beforeEach(() => {
  calls = [];
  payloads = [{ enabled: true, drives: [] }];
  install();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useDrive", () => {
  it("makes NO request at all when the cockpit cannot dispatch", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderHook(() => useDrive({ slug: "acme", enabled: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(calls).toHaveLength(0);
  });

  it("ticks once on mount — catching a drive started by curl — then arms no timer while at rest", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useDrive({ slug: "acme", enabled: true }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(result.current.live).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(calls).toHaveLength(1);
  });

  it("adopts a drive already running on the server and then polls it", async () => {
    payloads = [{ enabled: true, drives: [drive()] }];
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useDrive({ slug: "acme", enabled: true }));
    await waitFor(() => expect(result.current.live).toBe(true));
    expect(result.current.drive?.id).toBe("drive_1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_100);
    });
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
  });

  it("hands the TERMINAL status up exactly once, and stops polling with it", async () => {
    payloads = [
      { enabled: true, drives: [drive()] },
      { enabled: true, drives: [drive({ phase: "green", endedAt: "2026-08-28T11:00:00Z" })] },
    ];
    const onSettled = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderHook(() => useDrive({ slug: "acme", enabled: true, onSettled }));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_100);
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(onSettled.mock.calls[0]![0].phase).toBe("green");

    const after = calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(after);
  });

  it("never settles a drive it did not watch go live (a finished one from a past session)", async () => {
    payloads = [{ enabled: true, drives: [drive({ phase: "ceiling", endedAt: "2026-08-28T09:00:00Z" })] }];
    const onSettled = vi.fn();
    renderHook(() => useDrive({ slug: "acme", enabled: true, onSettled }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("adopts the 202 body on start so the panel paints before the first poll", async () => {
    const { result } = renderHook(() => useDrive({ slug: "acme", enabled: true }));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      await result.current.start({ repos: ["acme/a"], maxRuns: 3, maxCycles: 3, concurrency: 2 });
    });
    expect(calls).toContain("POST /api/org/local/drive");
    expect(result.current.live).toBe(true);
  });

  it("surfaces the server's own message instead of a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: "A drive is already running for this organization." }) }) as Response),
    );
    const { result } = renderHook(() => useDrive({ slug: "acme", enabled: true }));
    await waitFor(() => expect(result.current.error).toBe("A drive is already running for this organization."));
  });
});
