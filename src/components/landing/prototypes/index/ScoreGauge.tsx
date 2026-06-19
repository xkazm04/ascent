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

export function ScoreGauge({ size = 240, className = "" }: { size?: number; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  const n = LEVELS.length;
  const gap = circ * 0.018;
  const segArc = (circ - n * gap) / n;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className={className} role="img" aria-label="The maturity index runs from 0 to 100 across five levels.">
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
        initial={reduced ? false : { rotate: -210 }}
        whileInView={{ rotate: 0 }}
        viewport={{ once: false, margin: "-10%" }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 45, damping: 13, delay: 0.3 }}
      >
        <line x1={cx} y1={stroke - 3} x2={cx} y2={stroke + 13} stroke="#e2e8f0" strokeWidth={2.5} strokeLinecap="round" />
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
