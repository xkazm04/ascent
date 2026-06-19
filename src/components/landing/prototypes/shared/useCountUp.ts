"use client";

// A count-up that fires once when the element scrolls into view, and respects prefers-reduced-motion
// (jumps straight to the target). Attach the returned `ref` to the element that shows `display`.

import { useEffect, useRef, useState } from "react";
import { animate, useInView, useReducedMotion } from "framer-motion";
import { useMounted } from "@/components/report/chartMotion";

export function useCountUp(
  target: number,
  { duration = 1.1, decimals = 0 }: { duration?: number; decimals?: number } = {},
) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-12% 0px" });
  const reduced = useReducedMotion();
  const mounted = useMounted();
  const [value, setValue] = useState(0);

  useEffect(() => {
    // Only the animated path touches state, and only via framer's async onUpdate — never a
    // synchronous setState in the effect body. The reduced-motion value is derived below instead.
    if (reduced || !inView) return;
    const controls = animate(0, target, { duration, ease: "easeOut", onUpdate: setValue });
    return () => controls.stop();
  }, [inView, reduced, target, duration]);

  // Server + first client render show 0 (matches markup); the reduced-motion shortcut to the final
  // value only applies after mount, so reduced-motion users get no hydration mismatch.
  const shown = reduced && mounted ? target : value;
  const display = decimals > 0 ? shown.toFixed(decimals) : Math.round(shown).toString();
  return { ref, value: shown, display };
}
