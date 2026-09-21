// @vitest-environment jsdom
//
// The presence stamp fires only after FIVE CONTINUOUS VISIBLE SECONDS, once per mount. A tab that is
// hidden — at mount, or before the dwell elapses — never stamps; coming back restarts the full dwell.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEEN_DWELL_MS, useSeenStamp } from "./useSeenStamp";

let state: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState) {
  state = next;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  state = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
});
afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe("useSeenStamp", () => {
  it("stamps once after five visible seconds — not a millisecond before", () => {
    const stamp = vi.fn(async () => true);
    const { rerender } = renderHook(() => useSeenStamp("acme", true, stamp));
    advance(SEEN_DWELL_MS - 1);
    expect(stamp).not.toHaveBeenCalled();
    advance(1);
    expect(stamp).toHaveBeenCalledTimes(1);
    expect(stamp).toHaveBeenCalledWith("acme");
    rerender();
    advance(SEEN_DWELL_MS * 4);
    expect(stamp).toHaveBeenCalledTimes(1);
  });

  it("never stamps from a hidden tab", () => {
    state = "hidden";
    const stamp = vi.fn(async () => true);
    renderHook(() => useSeenStamp("acme", true, stamp));
    advance(SEEN_DWELL_MS * 10);
    expect(stamp).not.toHaveBeenCalled();
  });

  it("restarts the full dwell when the tab hides before it elapses", () => {
    const stamp = vi.fn(async () => true);
    renderHook(() => useSeenStamp("acme", true, stamp));
    advance(3_000);
    setVisibility("hidden");
    advance(SEEN_DWELL_MS * 2);
    expect(stamp).not.toHaveBeenCalled();
    setVisibility("visible");
    advance(SEEN_DWELL_MS - 1);
    expect(stamp).not.toHaveBeenCalled();
    advance(1);
    expect(stamp).toHaveBeenCalledTimes(1);
  });

  it("stamps nothing while disabled (a briefing that could not be derived)", () => {
    const stamp = vi.fn(async () => true);
    renderHook(() => useSeenStamp("acme", false, stamp));
    advance(SEEN_DWELL_MS * 3);
    expect(stamp).not.toHaveBeenCalled();
  });

  it("swallows a failed stamp — the anchor simply stays where it was", async () => {
    const stamp = vi.fn(async () => {
      throw new Error("offline");
    });
    renderHook(() => useSeenStamp("acme", true, stamp));
    advance(SEEN_DWELL_MS);
    await act(async () => {});
    expect(stamp).toHaveBeenCalledTimes(1);
  });
});
