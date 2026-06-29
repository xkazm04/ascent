"use client";

// /about's take on the level ladder — a stepped staircase ascent (distinct from the homepage's
// smooth flight-path TrajectoryChart, so the two pages don't share the same levels component). Each
// rung is a ramp-tinted platform that draws in; a climber dot ascends the staircase on reveal.

import { motion, useReducedMotion } from "framer-motion";
import { LEVELS } from "@/lib/maturity/model";
import { LEVEL_HEX } from "@/lib/ui";
import { gatedReveal } from "./motionReveal";

const X0 = 70;
const STEP_W = 168;
// Platform-top geometry is derived from LEVELS.length, not a fixed table: the lowest (first) step sits
// at BOTTOM_Y and the highest (last) at TOP_Y, interpolated evenly across the rungs. Adding a maturity
// level to the model now reshapes the staircase automatically (no NaN coords from a missing YS slot).
const TOP_Y = 100;
const BOTTOM_Y = 300;
const RIGHT_PAD = 50;
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
  const n = LEVELS.length;
  const yFor = (i: number) => (n > 1 ? BOTTOM_Y - ((BOTTOM_Y - TOP_Y) * i) / (n - 1) : BOTTOM_Y);
  const steps = LEVELS.map((l, i) => ({ id: l.id, name: l.name, x: X0 + i * STEP_W, y: yFor(i) }));
  const vbWidth = X0 + n * STEP_W + RIGHT_PAD;
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
    <svg viewBox={`0 0 ${vbWidth} 360`} className="h-auto w-full" role="img" aria-label={`The ${n}-level ascent from manual to autonomous, governed delivery.`}>
      {steps.map((s, i) => {
        const color = LEVEL_HEX[s.id];
        const mid = s.x + STEP_W / 2;
        return (
          <g key={s.id}>
            {i > 0 && (
              <motion.line
                x1={s.x} y1={steps[i - 1]!.y} x2={s.x} y2={s.y}
                stroke={color} strokeWidth={2} strokeDasharray="3 4"
                {...gatedReveal(reduced, { initial: { opacity: 0 }, final: { opacity: 0.45 }, transition: { duration: 0.3, delay: 0.1 + i * 0.16 } })}
                viewport={{ once: false, margin: "-80px" }}
              />
            )}
            <motion.line
              x1={s.x} y1={s.y} x2={s.x + STEP_W} y2={s.y}
              stroke={color} strokeWidth={5} strokeLinecap="round"
              {...gatedReveal(reduced, { initial: { pathLength: 0, opacity: 0 }, final: { pathLength: 1, opacity: 1 }, transition: { duration: 0.45, ease: "easeOut", delay: 0.15 + i * 0.16 } })}
              viewport={{ once: false, margin: "-80px" }}
            />
            <motion.circle
              cx={mid} cy={s.y} r={6} fill={color}
              {...gatedReveal(reduced, { initial: { scale: 0 }, final: { scale: 1 }, transition: { type: "spring", stiffness: 280, damping: 16, delay: 0.25 + i * 0.16 } })}
              viewport={{ once: false, margin: "-80px" }}
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
        {...gatedReveal(reduced, {
          initial: { cx: cx[0], cy: cy[0] },
          final: { cx, cy },
          reducedTo: { cx: cx[cx.length - 1], cy: cy[cy.length - 1] },
          transition: { duration: 2.4, ease: "easeInOut", delay: 0.4 },
        })}
        viewport={{ once: false, margin: "-80px" }}
      />
    </svg>
  );
}
