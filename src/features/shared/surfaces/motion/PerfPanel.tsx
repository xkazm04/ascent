"use client";

// performance-discipline: one rAF loop (one clock) drives two needles by writing `transform`
// through refs — the component renders ZERO times per frame, and the counter proves it: it moves
// only at human-scale moments (start, settle). Both counters are written into ref'd spans, never
// into state. The timestep is clamped centrally so a backgrounded tab cannot resume with a
// seconds-long delta. Reduced: no loop is scheduled; the needles are placed at their end state.

import { useEffect, useRef, useState } from "react";
import { BTN, Readout, Region } from "./sceneParts";

const SWEEP_MS = 2000;
const MAX_DT_MS = 64;
const ease = (q: number) => 1 - Math.pow(1 - q, 3);

export function PerfRegion({ reduced }: { reduced: boolean }) {
  // The render counter lives in the DOM node itself — a post-commit write, so counting renders
  // cannot cause one, and nothing React owns is mutated to keep it.
  const renders = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = renders.current;
    if (el) el.textContent = String(Number(el.textContent || "0") + 1);
  });
  const [run, setRun] = useState(0);
  const [state, setState] = useState<"idle" | "running" | "settled">("idle");
  const a = useRef<HTMLDivElement>(null);
  const b = useRef<HTMLDivElement>(null);
  const frames = useRef<HTMLSpanElement>(null);

  const write = (p: number) => {
    if (a.current) a.current.style.transform = `scaleX(${p})`;
    if (b.current) b.current.style.transform = `translateX(${p * 100}%)`;
  };

  const start = () => {
    if (reduced) {
      write(1); // the instant path: end state, no loop, settled at once
      setState("settled");
      return;
    }
    setState("running");
    setRun((r) => r + 1);
  };

  useEffect(() => {
    if (run === 0) return;
    let raf = 0;
    let last = performance.now();
    let t = 0;
    let n = 0;
    const tick = (now: number) => {
      const dt = Math.min(now - last, MAX_DT_MS); // clamp: a frozen clock resumes in one bounded step
      last = now;
      t += dt;
      n += 1;
      const q = Math.min(1, t / SWEEP_MS);
      if (a.current) a.current.style.transform = `scaleX(${ease(q)})`;
      if (b.current) b.current.style.transform = `translateX(${ease(q) * 100}%)`;
      if (frames.current) frames.current.textContent = String(n);
      if (q < 1) raf = requestAnimationFrame(tick);
      else setState("settled"); // the reactive layer hears about the animation ONCE more: at rest
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run]);

  return (
    <Region technique="performance-discipline" title="Frames outside React" note="Two needles, one clock, writes through refs. Watch the render counter stay still while frames tick.">
      <div className="space-y-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-divider">
          <div ref={a} className="h-full w-full origin-left bg-accent" style={{ transform: "scaleX(0)" }} aria-hidden />
        </div>
        <div className="relative h-6 w-full rounded-md border border-divider">
          <div ref={b} className="absolute left-0 top-1 h-4 w-[calc(50%-0.5rem)]" style={{ transform: "translateX(0)" }} aria-hidden>
            <span className="block h-4 w-4 rounded-sm bg-accent" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={BTN} onClick={start} disabled={state === "running"}>
            {state === "running" ? "sweeping…" : "run 2s sweep"}
          </button>
          <span className="type-caption text-slate-500" data-sweep-state={state}>
            state: {state}
          </span>
        </div>
        <Readout label="renders" value={<span ref={renders}>0</span>} />
        <Readout label="frames written" value={<span ref={frames}>0</span>} />
        <p className="type-caption text-slate-500">Renders move on start and settle only. A value routed through setState would render sixty times a second.</p>
      </div>
    </Region>
  );
}
