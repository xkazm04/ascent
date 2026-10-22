// @vitest-environment jsdom
//
// The run's end keeps a roster, not counters: a partial fleet run's failures are re-selected, and
// retryFailed() starts ONE ordinary scoped scan of exactly them (the server keeps its own watchlist
// intersection and per-repo reservation, so nothing about what is charged moves here).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const startScan = vi.fn();
vi.mock("@/components/shared/scan/useScanStream", () => ({ useScanStream: () => startScan }));

import { useOrgScanButton } from "./useOrgScanButton";

beforeEach(() => {
  startScan.mockReset();
  startScan.mockImplementationOnce(async ({ onMessage, onStreamEnd }) => {
    onMessage({ event: "repo", data: { repo: "a/x", error: "boom", charged: false } });
    onMessage({ event: "repo", data: { repo: "a/q", error: "lease expired after max attempts", charged: true } });
    onMessage({ event: "repo", data: { repo: "a/z", level: "L3", overall: 61 } });
    onMessage({ event: "repo", data: { repo: "a/y", skipped: "no_token" } });
    onStreamEnd();
  });
});
afterEach(() => cleanup());

describe("useOrgScanButton - retry the failures", () => {
  it("keeps the failures by name, then retries exactly them in one scoped scan", async () => {
    const { result } = renderHook(() => useOrgScanButton("acme", 4));
    await act(async () => { await result.current.run(); });
    expect(result.current.p.roster.failed.map((f) => f.repo)).toEqual(["a/x", "a/q"]);

    let release: () => void = () => {};
    startScan.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.retryFailed(); });

    expect(startScan).toHaveBeenCalledTimes(2);
    expect(startScan.mock.calls[1][0].body).toEqual({ org: "acme", repos: ["a/x", "a/q"] });
    expect(result.current.p.roster.pending).toEqual(["a/x", "a/q"]);
    expect(result.current.p.roster.failed).toEqual([]);
    expect(result.current.p.total).toBe(2);
    await act(async () => { release(); await pending; });
  });

  it("does nothing when the run had no failures", async () => {
    startScan.mockReset();
    startScan.mockImplementationOnce(async ({ onStreamEnd }) => onStreamEnd());
    const { result } = renderHook(() => useOrgScanButton("acme", 1));
    await act(async () => { await result.current.run(); });
    await act(async () => { await result.current.retryFailed(); });
    expect(startScan).toHaveBeenCalledTimes(1);
  });
});
