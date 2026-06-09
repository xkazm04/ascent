"use client";

import { useEffect, useRef, useState } from "react";

/** Tween an integer toward `target` with an ease-out cubic, honoring prefers-reduced-motion. */
function useTween(target: number, ms = 650): number {
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

export function AnimatedStat({
  label,
  value,
  color,
  render,
}: {
  label: string;
  value: number | null;
  color?: string;
  render?: (n: number) => string;
}) {
  const tweened = useTween(value ?? 0);
  const shown = value == null ? "—" : render ? render(tweened) : String(tweened);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="font-mono text-sm uppercase tracking-widest text-slate-500">{label}</div>
      <div
        className="mt-1 font-mono text-3xl font-bold tabular-nums sm:text-4xl"
        style={{ color: value == null ? "#fff" : color ?? "#fff" }}
      >
        {shown}
      </div>
    </div>
  );
}
