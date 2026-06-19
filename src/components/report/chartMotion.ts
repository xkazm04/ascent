"use client";

// Shared motion hooks for the dependency-free report charts. Kept in one small client module so
// every chart can gate its entrance transitions on the same reduced-motion + mounted signals.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useInView } from "framer-motion";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * True when the user has asked the OS to reduce motion — gate entrance transitions on this.
 * Reads the media query via useSyncExternalStore so there's no setState-in-effect and no SSR
 * hydration mismatch (the server snapshot is always `false`).
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCED_MOTION_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/** Fires `true` one frame after mount, so transitions animate from their initial state. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return mounted;
}

/**
 * Replays an animation each time the element scrolls into view (for the snap deck — land on a
 * section, the chart re-draws). Attach `ref` to a STABLE container; `replayKey` increments on every
 * entry — remount the animated subtree with it (e.g. `key={replayKey}` on a Recharts chart) to
 * re-trigger. `replayKey === 0` until the first entry, so callers can hold a placeholder. The default
 * margin only counts the element as in-view once it reaches the middle band of the viewport.
 */
export function useReplayOnView<T extends Element = HTMLDivElement>(margin = "-25% 0px -25% 0px") {
  const ref = useRef<T>(null);
  const inView = useInView(ref, { margin: margin as never });
  const [replayKey, setReplayKey] = useState(0);
  const wasInView = useRef(false);
  useEffect(() => {
    if (inView && !wasInView.current) setReplayKey((k) => k + 1);
    wasInView.current = inView;
  }, [inView]);
  return { ref, inView, replayKey };
}
