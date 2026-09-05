"use client";

// Reads the OS "reduce motion" setting and keeps it live. Deliberately NOT framer-motion's hook of
// the same name: <Defer> is imported by ordinary panels, and pulling framer into their chunk to read
// one media query would undo the payload win deferring is there to buy.
//
// Starts `false` so the server render and the first client render agree (no hydration mismatch); the
// effect corrects it on mount and the listener tracks later changes.

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return;
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}
