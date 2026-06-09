"use client";

// Shared motion hooks for the dependency-free report charts. Kept in one small client module so
// every chart can gate its entrance transitions on the same reduced-motion + mounted signals.

import { useEffect, useState, useSyncExternalStore } from "react";

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
