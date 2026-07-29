// @vitest-environment jsdom
// Pins live-war-room #3 (ambiguity-ui-scan-2026-07-16): the screen wake lock used to be
// fired-and-forgotten — the sentinel was discarded, so (a) when the browser auto-released the lock
// on visibility loss (tab switch / projector input flip) nothing re-acquired it and the screen
// slept mid-presentation, and (b) exiting TV mode could never release it, forcing the display
// awake for the tab's lifetime. enterTvMode/releaseWakeLock now manage the sentinel:
// re-acquire on visibilitychange→visible while held, release + stop re-acquiring on exit.

import { afterEach, describe, expect, it, vi } from "vitest";
import { enterTvMode, releaseWakeLock } from "@/components/org/intelligence/live/LiveWarRoomHeader";

type WakeNav = Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } };

function stubWakeLock() {
  const release = vi.fn(async () => {});
  const request = vi.fn(async (_t: string) => ({ release }));
  (navigator as WakeNav).wakeLock = { request };
  return { request, release };
}

function fireVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  releaseWakeLock(); // reset module state between tests (idempotent)
  delete (navigator as WakeNav).wakeLock;
});

describe("war-room screen wake lock lifecycle", () => {
  it("re-acquires the lock when the page becomes visible again (browser auto-released it while hidden)", async () => {
    const { request } = stubWakeLock();
    await enterTvMode();
    expect(request).toHaveBeenCalledTimes(1);

    // Presenter alt-tabs (browser silently releases the lock), then returns to the wall.
    fireVisibility("hidden");
    fireVisibility("visible");
    await Promise.resolve(); // let the async re-acquire settle

    // The old fire-and-forget code never re-requested — the screen slept mid-presentation.
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("releases the held sentinel on exit and stops re-acquiring afterwards", async () => {
    const { request, release } = stubWakeLock();
    await enterTvMode();
    expect(request).toHaveBeenCalledTimes(1);

    releaseWakeLock();
    // The old code threw the sentinel away, so release was impossible (kiosk display burn).
    expect(release).toHaveBeenCalledTimes(1);

    // After exit, a visibility return must NOT re-acquire (the wall is closed).
    fireVisibility("hidden");
    fireVisibility("visible");
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("survives a missing/denied wake-lock API (best-effort: no throw, release is a no-op)", async () => {
    delete (navigator as WakeNav).wakeLock;
    await expect(enterTvMode()).resolves.toBeUndefined();
    expect(() => releaseWakeLock()).not.toThrow();
  });
});
