"use client";

// /about's take on the level ladder — a stepped staircase ascent (distinct from the homepage's
// smooth flight-path TrajectoryChart, so the two pages don't share the same levels component). Each
// rung is a ramp-tinted platform that draws in; a climber dot ascends the staircase on reveal.

import { motion, useReducedMotion } from "framer-motion";
import { LEVELS } from "@/lib/maturity/model";
import { LEVEL_HEX } from "@/lib/ui";

const X0 = 70;
const STEP_W = 168;
// Platform tops span a fixed vertical band, rising left→right. Derived from LEVELS.length (like
// ScoreGauge/DimensionMatrix/TrajectoryChart) instead of a hardcoded per-step array, so adding a level
// to the rubric can't produce an undefined Y → NaN SVG coords → a silently broken staircase.
const Y_BOTTOM = 300; // lowest level's platform
const Y_TOP = 100; // highest level's platform
const UNLOCK: Record<string, string> = {
  L1: "ad-hoc AI",
  L2: "tools adopted",
  L3: "standard workflow",
  L4: "agents in the loop",
  L5: "self-governing",
};

export function AboutAscentSteps() {
  // ABOUT #1: the climber travels via `cx`/`cy` keyframes (non-transform), and the rungs draw via
  // `pathLength`/opacity — none of which reducedMotion="user" degrades. Gate them on reduced motion
  // and render the final/static staircase + climber-at-summit state instead.
  const reduced = useReducedMotion();
  const rise = LEVELS.length > 1 ? (Y_BOTTOM - Y_TOP) / (LEVELS.length - 1) : 0;
  const steps = LEVELS.map((l, i) => ({ id: l.id, name: l.name, x: X0 + i * STEP_W, y: Y_BOTTOM - i * rise }));
  // Climber keyframes: trace the staircase corners (platform, riser-up, platform, …).
  const cx: number[] = [];
  const cy: number[] = [];
  steps.forEach((s, i) => {
    if (i > 0) {
      cx.push(s.x, s.x);
      cy.push(steps[i - 1]!.y, s.y);
    } else {
      cx.push(s.x);
      cy.push(s.y);
    }
    cx.push(s.x + STEP_W);
    cy.push(s.y);
  });

  return (
    <svg viewBox="0 0 960 360" className="h-auto w-full" role="img" aria-label="The five-level ascent from manual to autonomous, governed delivery.">
      {steps.map((s, i) => {
        const color = LEVEL_HEX[s.id];
        const mid = s.x + STEP_W / 2;
        return (
          <g key={s.id}>
            {i > 0 && (
              <motion.line
                x1={s.x} y1={steps[i - 1]!.y} x2={s.x} y2={s.y}
                stroke={color} strokeWidth={2} strokeDasharray="3 4"
                initial={reduced ? false : { opacity: 0 }}
                animate={reduced ? { opacity: 0.45 } : undefined}
                whileInView={reduced ? undefined : { opacity: 0.45 }}
                viewport={{ once: false, margin: "-80px" }}
                transition={reduced ? { duration: 0 } : { duration: 0.3, delay: 0.1 + i * 0.16 }}
              />
            )}
            <motion.line
              x1={s.x} y1={s.y} x2={s.x + STEP_W} y2={s.y}
              stroke={color} strokeWidth={5} strokeLinecap="round"
              initial={reduced ? false : { pathLength: 0, opacity: 0 }}
              animate={reduced ? { pathLength: 1, opacity: 1 } : undefined}
              whileInView={reduced ? undefined : { pathLength: 1, opacity: 1 }}
              viewport={{ once: false, margin: "-80px" }}
              transition={reduced ? { duration: 0 } : { duration: 0.45, ease: "easeOut", delay: 0.15 + i * 0.16 }}
            />
            <motion.circle
              cx={mid} cy={s.y} r={6} fill={color}
              initial={reduced ? false : { scale: 0 }}
              animate={reduced ? { scale: 1 } : undefined}
              whileInView={reduced ? undefined : { scale: 1 }}
              viewport={{ once: false, margin: "-80px" }}
              transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 280, damping: 16, delay: 0.25 + i * 0.16 }}
              style={{ transformOrigin: `${mid}px ${s.y}px` }}
            />
            <text x={mid} y={s.y - 16} textAnchor="middle" className="fill-white font-mono" fontSize={17} fontWeight={700}>
              {s.id}
            </text>
            <text x={mid} y={s.y + 24} textAnchor="middle" className="fill-slate-300 font-mono" fontSize={13}>
              {s.name}
            </text>
            <text x={mid} y={s.y + 42} textAnchor="middle" className="fill-slate-500 font-mono" fontSize={11}>
              {UNLOCK[s.id]}
            </text>
          </g>
        );
      })}
      {/* The climber traces the staircase via `cx`/`cy` keyframes — for reduced-motion users render
          it parked at the summit (final keyframe) with no travel. */}
      <motion.circle
        r={7} fill="#fff" stroke="#3b9eff" strokeWidth={2.5}
        initial={reduced ? false : { cx: cx[0], cy: cy[0] }}
        animate={reduced ? { cx: cx[cx.length - 1], cy: cy[cy.length - 1] } : undefined}
        whileInView={reduced ? undefined : { cx, cy }}
        viewport={{ once: false, margin: "-80px" }}
        transition={reduced ? { duration: 0 } : { duration: 2.4, ease: "easeInOut", delay: 0.4 }}
      />
    </svg>
  );
}
