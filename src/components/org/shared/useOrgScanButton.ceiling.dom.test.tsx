// @vitest-environment jsdom
//
// The "N queued" follow in useOrgScanButton shares queueFollow's ceiling: it pauses while the tab is
// hidden, stops at the read cap keeping the last count, and never claims the run finished.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const startScan = vi.fn();
vi.mock("@/components/org/shared/useScanStream", () => ({ useScanStream: () => startScan }));

import { useOrgScanButton } from "./useOrgScanButton";
import { QUEUE_FOLLOW_MAX_READS, QUEUE_FOLLOW_POLL_MS } from "./queueFollow";

function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
  document.dispatchEvent(new Event("visibilitychange"));
}
async function advance(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  fetchMock = vi.fn(async () => Response.json({ pending: 3 }));
  vi.stubGlobal("fetch", fetchMock);
  // The bulk run ends with a budget-stopped `queued` frame: a durable remainder of 3.
  startScan.mockImplementation(async ({ onMessage, onStreamEnd }) => {
    onMessage({ event: "queued", data: { runId: "run-1", queued: 3, total: 5 } });
    onStreamEnd();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); setVisibility("visible"); });

async function startQueued() {
  const hook = renderHook(() => useOrgScanButton("acme", 5));
  await act(async () => { await hook.result.current.run(); });
  return hook;
}

describe("useOrgScanButton — queue follow ceiling", () => {
  it("stops at the read cap, keeps the last count and flags it stopped", async () => {
    const { result } = await startQueued();
    await advance(QUEUE_FOLLOW_POLL_MS * (QUEUE_FOLLOW_MAX_READS + 5));
    // First read lands one interval in, so the 30-minute wall clock can trip a read before the cap.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(QUEUE_FOLLOW_MAX_READS - 1);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(QUEUE_FOLLOW_MAX_READS);
    expect(result.current.p.queued).toMatchObject({ pending: 3, stopped: true });
    expect(result.current.p.error).toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(1); // only the stream-end refresh, never a "finished" one
  });

  it("makes no read while hidden, reads once on return, then resumes", async () => {
    await startQueued();
    await advance(QUEUE_FOLLOW_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    setVisibility("hidden");
    await advance(QUEUE_FOLLOW_POLL_MS * 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await advance();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(QUEUE_FOLLOW_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("still clears the queue and refreshes when pending reaches 0", async () => {
    fetchMock.mockImplementation(async () => Response.json({ pending: 0 }));
    const { result } = await startQueued();
    await advance(QUEUE_FOLLOW_POLL_MS * 3);
    expect(result.current.p.queued).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
