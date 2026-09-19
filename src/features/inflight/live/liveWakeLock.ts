"use client";

type WakeSentinel = { release: () => Promise<void> };

// Module-scope wake-lock manager (live-war-room 07-16 #3). The old code requested the lock once and
// DISCARDED the sentinel — but browsers auto-release a screen wake lock whenever the page is hidden
// (tab switch, OS overlay, projector input flip), so the dominant real-world failure was a silent
// mid-presentation loss of the keep-awake guarantee, with no way to release the lock on exit either
// (display/battery burn on kiosk hardware for the tab's lifetime). Keep the sentinel, re-acquire on
// visibility return while the wall is active, and release on exit (TV-mode exit or leaving fullscreen).
let wakeSentinel: WakeSentinel | null = null;
let wakeHeld = false; // intent: the wall is active and wants the screen kept awake
let wakeListenersOn = false;

async function acquireWakeLock() {
  try {
    wakeSentinel =
      (await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<WakeSentinel> } }).wakeLock?.request(
        "screen",
      )) ?? null;
  } catch {
    wakeSentinel = null; // wake-lock unsupported / denied — best-effort
  }
}

function onWakeVisibility() {
  // The browser released the lock when the page hid; re-acquire the moment it's visible again.
  if (wakeHeld && document.visibilityState === "visible") void acquireWakeLock();
}

function onWakeFullscreen() {
  // Leaving fullscreen is the wall's universal exit gesture (incl. the kiosk, which has no exit
  // button) — drop the lock so the display isn't forced awake after the wall closes.
  if (!document.fullscreenElement) releaseWakeLock();
}

/** Release the screen wake lock and stop re-acquiring it (TV-mode / fullscreen exit). Idempotent. */
export function releaseWakeLock() {
  wakeHeld = false;
  if (wakeListenersOn) {
    document.removeEventListener("visibilitychange", onWakeVisibility);
    document.removeEventListener("fullscreenchange", onWakeFullscreen);
    wakeListenersOn = false;
  }
  void wakeSentinel?.release().catch(() => {});
  wakeSentinel = null;
}

/** Fullscreen the wall + keep the screen awake (best-effort; both fail silently if unsupported). */
export async function enterTvMode() {
  try {
    await document.documentElement.requestFullscreen?.();
  } catch {
    /* fullscreen denied */
  }
  wakeHeld = true;
  if (!wakeListenersOn) {
    document.addEventListener("visibilitychange", onWakeVisibility);
    document.addEventListener("fullscreenchange", onWakeFullscreen);
    wakeListenersOn = true;
  }
  await acquireWakeLock();
}
