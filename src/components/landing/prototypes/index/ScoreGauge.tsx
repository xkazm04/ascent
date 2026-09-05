"use client";

// The "index ring" — a donut of five equal arcs in the red→green level ramp (the 0–100 maturity
// scale, one arc per level) with a thin indicator that sweeps once to rest at the top, like a rating
// instrument being calibrated. Editorial and restrained; reduced-motion shows it already at rest.
// No fabricated score: the centre states the scale (0–100), not a reading.

import { motion } from "framer-motion";
import { LEVELS } from "@/lib/maturity/model";
import { LEVEL_HEX } from "@/lib/ui";
import { usePrefersReducedMotion } from "@/components/report/chartMotion";
import type { LevelId } from "@/lib/types";

// Sweep/geometry calibration — eyeballed against the 240px default and recorded so future tuning
// doesn't have to reverse-engineer intent:
// Start angle of the calibration tick's one-shot sweep. -210° starts the tick just past the first
// (red) arc so it crosses every level band exactly once before resting at the top; the value is
// aesthetic (a "most of the dial" sweep), not derived from the level count.
const SWEEP_START_DEG = -210;
// Inter-segment gap as a fraction of the circumference — the thinnest visible break between level
// arcs at the default size that still reads as five distinct segments after antialiasing.
const GAP_RATIO = 0.018;
// The calibration tick straddles the ring: from 3px outside the stroke band to 1px past its inner
// edge (stroke - TICK_OVERHANG .. stroke + TICK_LENGTH in the y-down SVG space), so it reads as a
// gauge needle crossing the arc rather than a floating dash.
const TICK_OVERHANG = 3;
const TICK_LENGTH = 13;

export function ScoreGauge({ size = 240, className = "" }: { size?: number; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  const n = LEVELS.length;
  const gap = circ * GAP_RATIO;
  const segArc = (circ - n * gap) / n;

  return (
    // Level count is derived (not the hand-written "five" it once was), so SR users and sighted
    // users can't drift apart if the rubric gains or loses a level.
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className={className} role="img" aria-label={`The maturity index runs from 0 to 100 across ${n} levels.`}>
      <g transform={`rotate(-90 ${cx} ${cx})`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#101a2e" strokeWidth={stroke} />
        {LEVELS.map((l, k) => (
          <motion.circle
            key={l.id}
            cx={cx}
            cy={cx}
            r={r}
            fill="none"
            stroke={LEVEL_HEX[l.id as LevelId]}
            strokeWidth={stroke}
            strokeLinecap="butt"
            strokeDasharray={`${segArc} ${circ - segArc}`}
            strokeDashoffset={-(k * (segArc + gap))}
            initial={reduced ? false : { opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: false, margin: "-10%" }}
            transition={reduced ? { duration: 0 } : { duration: 0.5, delay: 0.1 + k * 0.08 }}
          />
        ))}
      </g>

      {/* calibration indicator: a short outer tick that sweeps once to rest at the top */}
      <motion.g
        style={{ originX: "50%", originY: "50%" }}
        initial={reduced ? false : { rotate: SWEEP_START_DEG }}
        whileInView={{ rotate: 0 }}
        viewport={{ once: false, margin: "-10%" }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 45, damping: 13, delay: 0.3 }}
      >
        <line x1={cx} y1={stroke - TICK_OVERHANG} x2={cx} y2={stroke + TICK_LENGTH} stroke="#e2e8f0" strokeWidth={2.5} strokeLinecap="round" />
      </motion.g>

      {/* centre: the scale, not a score */}
      <text x={cx} y={cx + 2} textAnchor="middle" className="font-mono" fontSize={size > 200 ? 28 : 22} fontWeight={700} fill="#e2e8f0">
        0–100
      </text>
      <text x={cx} y={cx + 22} textAnchor="middle" className="font-mono uppercase" fontSize={9} letterSpacing={2} fill="#64748b">
        Maturity index
      </text>
    </svg>
  );
}
