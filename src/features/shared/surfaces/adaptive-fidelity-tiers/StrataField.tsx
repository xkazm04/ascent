"use client";

// The effect the tier feeds: an ambient altimeter field (the brand's strata motif) whose line count,
// drift period and glow pass come from STRATA[tier], read AT RENDER — never captured at mount. All
// twelve lines are allocated once from the table's top row; a lower tier draws a PREFIX, so a tier
// change frees nothing, allocates nothing, and remounts nothing. The drift is an unprompted loop, so
// it owes a visible pause control; under `reduced` the tier is the floor (static) and it starts paused.

import { useState } from "react";
import { STRATA, WASH, type Tier } from "./budgets";

const W = 400;
const H = 96;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Allocated ONCE, at the top row's count. Lower tiers are a prefix of this array. */
const ALL_LINES = (() => {
  const rnd = mulberry32(41);
  return Array.from({ length: STRATA.full.lines }, (_, i) => ({
    y: 8 + (i * (H - 16)) / (STRATA.full.lines - 1),
    dash: 6 + Math.round(rnd() * 18),
    gap: 4 + Math.round(rnd() * 10),
    width: 0.6 + rnd() * 0.8,
    phase: Math.round(rnd() * 40),
  }));
})();

const KEYFRAMES = `@keyframes fidelity-drift { from { transform: translateX(0); } to { transform: translateX(-40px); } }`;

export function StrataField({ tier, reduced }: { tier: Tier; reduced: boolean }) {
  const [paused, setPaused] = useState(reduced);
  const row = STRATA[tier]; // read where the parameter is used, so a downgrade is seen
  const wash = WASH[tier];
  const drifting = !reduced && !paused && row.driftMs > 0;
  const drawn = ALL_LINES.slice(0, row.lines);
  return (
    <div className="relative overflow-hidden rounded-lg border border-divider bg-surface-strong/40" data-strata-lines={drawn.length} data-strata-drifting={drifting}>
      <style>{KEYFRAMES}</style>
      {Array.from({ length: wash.layers }, (_, i) => (
        <div
          key={i}
          aria-hidden
          className="pointer-events-none absolute inset-0"
          data-wash-layer={i}
          style={{ opacity: wash.opacityCeiling, background: `radial-gradient(ellipse at ${i === 0 ? "20% 30%" : "80% 70%"}, var(--color-accent) 0%, transparent 60%)` }}
        />
      ))}
      <svg viewBox={`0 0 ${W} ${H}`} className="relative h-24 w-full" role="img" aria-label={`Strata field: ${drawn.length} lines at the ${tier} tier`}>
        <g style={{ animation: drifting ? `fidelity-drift ${row.driftMs}ms linear infinite` : "none" }}>
          {drawn.map((l, i) => (
            <line
              key={i}
              x1={-40}
              x2={W + 40}
              y1={l.y}
              y2={l.y}
              className={row.glowPass && i % 3 === 0 ? "stroke-accent" : "stroke-slate-500"}
              strokeWidth={l.width}
              strokeDasharray={`${l.dash} ${l.gap}`}
              strokeDashoffset={l.phase}
              opacity={row.glowPass && i % 3 === 0 ? 0.9 : 0.55}
            />
          ))}
        </g>
      </svg>
      <div className="absolute bottom-2 right-2 flex items-center gap-2">
        <span className="type-caption text-slate-500">{row.driftMs === 0 ? "static" : drifting ? `drift ${row.driftMs / 1000}s` : "paused"}</span>
        <button
          type="button"
          className="focus-ring rounded-md border border-slate-700 px-2 py-0.5 type-caption text-slate-300 hover:border-accent hover:text-white disabled:opacity-40"
          onClick={() => setPaused((p) => !p)}
          disabled={row.driftMs === 0 || reduced}
          aria-pressed={paused}
          aria-label={paused ? "Resume the drift" : "Pause the drift"}
        >
          {paused ? "▶ drift" : "■ pause"}
        </button>
      </div>
    </div>
  );
}
