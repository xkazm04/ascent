// Hooks for the war-room headline strip (LiveWarRoomStat.tsx): the count-up tween and the settled
// (debounced) sr-only announcement. Pulled out so the JSX file stays under the 200-LOC cap
// (docs/ORG-TABS-REFACTOR.md) — pure state/effects, no JSX.

import { useEffect, useRef, useState } from "react";

/** Tween an integer toward `target` with an ease-out cubic, honoring prefers-reduced-motion. */
export function useTween(target: number, ms = 650): number {
  const [val, setVal] = useState(target);
  // Holds the last displayed value so a new target animates from where the number actually is.
  // Only ever read/written inside the effect below (never during render).
  const valRef = useRef(target);
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = valRef.current;
    if (reduced || from === target) {
      valRef.current = target;
      setVal(target);
      return;
    }
    let raf = 0;
    let start = 0;
    const step = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (target - from) * eased);
      valRef.current = v;
      setVal(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

/**
 * The strip's settled voice. The tiles tween on EVERY landed result; announcing that would put a
 * second polite region in competition with the header's per-run progress count, so this speaks only
 * once the numbers have stopped moving AND no scan is in flight — i.e. once per run, plus once per
 * kiosk refresh that actually changed something. Seeded with the mount value so a page load is
 * silent: only real movement gets a voice.
 */
const SETTLE_MS = 1200;

export function useSettledAnnouncement(text: string, running: boolean): string {
  const [msg, setMsg] = useState("");
  const saidRef = useRef(text);
  useEffect(() => {
    if (running || text === saidRef.current) return;
    const t = setTimeout(() => {
      saidRef.current = text;
      setMsg(text);
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [text, running]);
  return msg;
}
