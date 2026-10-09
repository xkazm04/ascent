// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { REATTACH_POLL_MS, useImportReattach } from "./useImportReattach";
import { QUEUE_FOLLOW_MAX_MS, QUEUE_FOLLOW_MAX_READS } from "@/components/org/shared/queueFollow";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); setVisibility("visible"); });

const pending = () => Response.json({ pending: 1, total: 1, repos: [{ repo: "acme/web", state: "claimed" }] });
function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
  document.dispatchEvent(new Event("visibilitychange"));
}
function follow() {
  const onSettled = vi.fn();
  const onRows = vi.fn();
  return { ...renderHook(() => useImportReattach({ active: true, org: "acme", runId: "run-1", onRows, onSettled })), onSettled, onRows };
}
async function advance(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

describe("import re-attach ceiling and hidden-tab pause", () => {
  it("stops at the read cap with status 'stopped' and never settles", async () => {
    const fetch = vi.fn().mockImplementation(async () => pending());
    vi.stubGlobal("fetch", fetch);
    const { result, onSettled } = follow();
    await advance(REATTACH_POLL_MS * (QUEUE_FOLLOW_MAX_READS + 5));
    expect(fetch).toHaveBeenCalledTimes(QUEUE_FOLLOW_MAX_READS);
    expect(result.current.status).toBe("stopped");
    expect(result.current.pending).toBe(1);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("counts network blips toward the read cap", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const { result, onSettled } = follow();
    await advance(REATTACH_POLL_MS * (QUEUE_FOLLOW_MAX_READS + 5));
    expect(fetch).toHaveBeenCalledTimes(QUEUE_FOLLOW_MAX_READS);
    expect(result.current.status).toBe("stopped");
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("stops at the wall-clock ceiling (hidden time counts) without another read", async () => {
    const fetch = vi.fn().mockImplementation(async () => pending());
    vi.stubGlobal("fetch", fetch);
    const { result, onSettled } = follow();
    await advance();
    setVisibility("hidden");
    await advance(QUEUE_FOLLOW_MAX_MS + REATTACH_POLL_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await advance();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("stopped");
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("makes no read while hidden, then reads once immediately on return and resumes the cadence", async () => {
    const fetch = vi.fn().mockImplementation(async () => pending());
    vi.stubGlobal("fetch", fetch);
    follow();
    await advance();
    expect(fetch).toHaveBeenCalledTimes(1);
    setVisibility("hidden");
    await advance(REATTACH_POLL_MS * 5);
    expect(fetch).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await advance();
    expect(fetch).toHaveBeenCalledTimes(2);
    await advance(REATTACH_POLL_MS);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("still settles exactly as before when pending reaches 0 before the cap", async () => {
    const fetch = vi.fn().mockImplementationOnce(async () => pending())
      .mockImplementation(async () => Response.json({ pending: 0, total: 1, repos: [{ repo: "acme/web", state: "done" }] }));
    vi.stubGlobal("fetch", fetch);
    const { result, onSettled } = follow();
    await advance(REATTACH_POLL_MS * 3);
    expect(result.current.status).toBe("settled");
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("removes the visibility listener on unmount", async () => {
    const fetch = vi.fn().mockImplementation(async () => pending());
    vi.stubGlobal("fetch", fetch);
    const { unmount } = follow();
    await advance();
    setVisibility("hidden");
    await advance(REATTACH_POLL_MS);
    unmount();
    setVisibility("visible");
    await advance(REATTACH_POLL_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
