"use client";

// The playhead both live-theater variants of "The loop" run on — one shot, in view, replayable.
//
// It is deliberately the SAME motion contract the cockpit's observatory uses (`useDriftProgress`,
// src/features/inflight/live/observatory/observatoryMotion.ts): a 0→1 ease-out of bounded length,
// with prefers-reduced-motion short-circuited to the END STATE rather than to a skipped animation.
// Nothing here loops on a timer — the brand's rule is "motion is a beat, gated", and a marketing
// page that keeps animating after the reader leaves it on screen is a lava lamp, not an argument.
//
// Arming mirrors `Reveal`: the rest state (p = 1, the run finished) is what the server renders and
// what the first client render agrees with, and the "before" state is only armed in a layout effect
// on the client — so a reader with no JS, or a crawler, sees the completed run instead of a field
// frozen at its start.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Upper bound on one pass of the loop, per the brand's motion budget. */
export const LOOP_RUN_MS = 2400;

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Sub-progress of one staggered element: `p` re-based onto the window [`delay`, `delay + span`].
 * Lets several lanes/bodies run off a single playhead instead of one timer each.
 */
export const segment = (p: number, delay: number, span: number): number => clamp01((p - delay) / span);

export interface LoopPlayhead {
  /** Attach to the element whose visibility arms the run. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** 0 = the run's "before" state, 1 = its finished state. */
  p: number;
  replay: () => void;
  playing: boolean;
}

export function useLoopPlayhead(ms: number = LOOP_RUN_MS): LoopPlayhead {
  const ref = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(1);
  const [run, setRun] = useState(0);
  // React's documented "adjust state when a prop changes" pattern (a previous-value STATE, not a ref,
  // which is what keeps it legal during render) — lifted verbatim from `useDriftProgress`. Rewinding
  // here rather than inside the effect means the frame that starts a run is already at the "before"
  // state, so nothing flashes its end position first, and no setState runs inside an effect body.
  const [prevRun, setPrevRun] = useState(run);
  const raf = useRef(0);
  if (prevRun !== run) {
    setPrevRun(run);
    setP(prefersReducedMotion() ? 1 : 0);
  }

  useIsomorphicLayoutEffect(() => {
    // Reduced motion: never arm, never schedule — `p` stays at 1 and callers render the end state.
    if (prefersReducedMotion()) return;
    const el = ref.current;
    // No IntersectionObserver (jsdom, ancient browser): stay at the end state rather than stranding
    // the diagram at its "before" frame with nothing left to advance it.
    if (!el || typeof IntersectionObserver === "undefined") return;
    setP(0);
    const io = new IntersectionObserver(
      (entries) => {
        // Re-entry replays, matching `Reveal`'s once:false idiom — snapping back to this deck pane
        // should show the loop run again, not a spent diagram.
        for (const e of entries) if (e.isIntersecting) setRun((r) => r + 1);
      },
      { rootMargin: "-12%" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (run === 0 || prefersReducedMotion()) return;
    let start = 0;
    const step = (t: number) => {
      if (!start) start = t;
      const q = Math.min(1, (t - start) / ms);
      setP(1 - Math.pow(1 - q, 3));
      if (q < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [run, ms]);

  const replay = useCallback(() => setRun((r) => r + 1), []);
  return { ref, p, replay, playing: p < 1 };
}
