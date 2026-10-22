// The timer behind ThrottledNotice. Pure decisions live in scanThrottleModel (throttleStep); this hook
// only owns the clock, the tab's visibility and the one-shot guard.
//
// ONE RESUME PER THROTTLE. `onResume(true)` fires at most once for a given Throttle object, even under
// StrictMode's double effect or a visibility flip after it already fired: the parent re-runs the scan,
// and a refusal that comes back is a NEW Throttle with its own countdown.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { secondsLeft, throttleStep, type Throttle, type ThrottleStep } from "@/components/report/scanThrottleModel";

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
const visibleNow = () => document.visibilityState !== "hidden";
const visibleOnServer = () => true;

/** Ticks while a countdown is running. Starts at the time of the first render, read once. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);
  return now;
}

export type ThrottleResume = {
  /** Whole seconds until the window drains (0 once it has). */
  seconds: number;
  /** The window has drained: "Resume now" may be pressed. */
  ready: boolean;
  /** What the timer is doing: waiting, paused (hidden tab) or manual (auto-resumes spent). */
  mode: ThrottleStep["kind"];
};

export function useThrottleResume(
  throttle: Throttle,
  autoUsed: number,
  onResume: (auto: boolean) => void,
  rng: () => number = Math.random,
): ThrottleResume {
  const visible = useSyncExternalStore(subscribeVisibility, visibleNow, visibleOnServer);
  const firedFor = useRef<Throttle | null>(null);
  const onResumeRef = useRef(onResume);
  useEffect(() => {
    onResumeRef.current = onResume;
  }, [onResume]);
  const rngRef = useRef(rng);

  // The schedule: re-planned when the throttle, the spent count or the tab's visibility changes.
  useEffect(() => {
    if (firedFor.current === throttle) return;
    const fire = () => {
      if (firedFor.current === throttle) return;
      firedFor.current = throttle;
      onResumeRef.current(true);
    };
    const step = throttleStep(throttle, Date.now(), autoUsed, visible, rngRef.current);
    if (step.kind === "resume") {
      fire();
      return;
    }
    if (step.kind !== "wait") return;
    const id = setTimeout(fire, step.ms);
    return () => clearTimeout(id);
  }, [throttle, autoUsed, visible]);

  const now = useNow(true);
  const seconds = secondsLeft(throttle, now);
  const ready = now >= throttle.retryAt;
  // The same decision the schedule makes, read for display (the jitter is irrelevant to the label).
  const mode = throttleStep(throttle, now, autoUsed, visible, () => 0).kind;
  return { seconds, ready, mode };
}
