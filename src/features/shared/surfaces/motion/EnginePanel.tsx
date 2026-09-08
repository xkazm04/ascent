"use client";

// engine-selection: the same "move right" gesture on three engines, side by side, so ownership and
// interruption can be seen rather than argued. CSS keyframes are platform-owned and immune to
// MotionConfig; the framer spring retargets from its current position and velocity (press "retarget"
// mid-flight); the scrub is input-driven — the range input is the clock, so reversal is correct and
// no one-shot policy applies. Under reduction: the CSS preset resolves its own fallback, MotionConfig
// snaps the spring, and the scrub keeps its mapping but removes travel (opacity instead of x).

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { PRESETS, animationFor } from "./presets";
import { BTN, Region } from "./sceneParts";

const TRAVEL_PX = 120;

export function EngineRegion({ reduced }: { reduced: boolean }) {
  const [cssPlay, setCssPlay] = useState(0);
  const [target, setTarget] = useState(0);
  const scrubRef = useRef<HTMLDivElement>(null);
  const spring = PRESETS["spring-retarget"].tracks[0];
  const physics = spring.kind === "physics" ? spring : null;

  // Input-driven: the range writes the transform straight to the element. No state, no clock.
  const onScrub = (v: number) => {
    const el = scrubRef.current;
    if (!el) return;
    el.style.transform = reduced ? "none" : `translateX(${(v / 100) * TRAVEL_PX}px)`;
    el.style.opacity = reduced ? String(0.4 + (v / 100) * 0.6) : "1";
  };

  return (
    <Region technique="engine-selection" title="Three engines, one gesture" note="Who owns it, what can switch it off, what happens when it is interrupted.">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2 rounded-lg border border-divider p-2">
          <p className="type-caption text-slate-200">CSS keyframes</p>
          <div className="h-8">
            <span key={cssPlay} className="inline-block h-6 w-6 rounded-md bg-accent" style={{ animation: animationFor("entrance", reduced) }} aria-hidden />
          </div>
          <button type="button" className={BTN} onClick={() => setCssPlay((n) => n + 1)}>
            replay
          </button>
          <p className="type-caption text-slate-500">Platform-owned. Off-thread. MotionConfig cannot see it; the preset carries its own fallback.</p>
        </div>

        <div className="space-y-2 rounded-lg border border-divider p-2">
          <p className="type-caption text-slate-200">framer spring</p>
          <div className="h-8">
            <motion.span
              className="inline-block h-6 w-6 rounded-md bg-accent"
              animate={{ x: target }}
              transition={physics ? { type: "spring", stiffness: physics.stiffness, damping: physics.damping } : undefined}
              aria-hidden
            />
          </div>
          <button type="button" className={BTN} onClick={() => setTarget((t) => (t >= TRAVEL_PX ? 0 : t + TRAVEL_PX / 2))}>
            retarget
          </button>
          <p className="type-caption text-slate-500">
            Library-owned; the global switch is <span className="text-slate-300">MotionConfig</span>. Retargets mid-flight from position + velocity; settle bound{" "}
            {physics?.settleBoundMs}ms.
          </p>
        </div>

        <div className="space-y-2 rounded-lg border border-divider p-2">
          <p className="type-caption text-slate-200">input-driven scrub</p>
          <div className="h-8">
            <div ref={scrubRef} className="inline-block h-6 w-6 rounded-md bg-accent" aria-hidden />
          </div>
          <input type="range" min={0} max={100} defaultValue={0} onChange={(e) => onScrub(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" aria-label="Scrub position" />
          <p className="type-caption text-slate-500">You are the clock. No duration, no stop control, no one-shot — reversal is the point. Reduced: bounded to opacity.</p>
        </div>
      </div>
    </Region>
  );
}
