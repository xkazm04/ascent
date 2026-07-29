"use client";

// The organization census dial — the /about-org masthead's instrument.
//
// Deliberately NOT the landing's ScoreGauge. That gauge states the SCALE (five level arcs, 0–100) and
// is the right object for a page about scoring one repository. This page's whole argument is that an
// organization is a POPULATION, so its instrument has to show a population: one radial tick per
// repository, its length and colour both carrying that repo's maturity, with the org index at the
// centre being the actual mean of the ticks drawn around it. The picture and the number agree because
// the number is computed from the picture.
//
// Data is deterministic and integer-only (no Math.random, no Date, no trig on unstable inputs), so the
// server and client renders agree byte for byte — the same discipline publicStars.ts documents, and
// the reason the caption says "illustrative fleet" rather than implying a real customer's numbers.

import { useMemo } from "react";
import { motion } from "framer-motion";
import { scoreHex } from "@/lib/ui";
import { levelForScore } from "@/lib/maturity/model";
import { usePrefersReducedMotion } from "@/components/report/chartMotion";

const TICKS = 48;
const BOX = 260;
const C = BOX / 2;
/** Inner radius of the tick ring — leaves room for the centred index read-out. */
const R_INNER = 84;
/** A tick's minimum reach past the ring, and how much more the best score adds. */
const REACH_MIN = 7;
const REACH_SPAN = 26;

interface Tick {
  score: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

/** Deterministic pseudo-fleet: the same `(i * 37 + 11) % 100` walk FleetGrid uses, so the two
 *  illustrative fleets on the marketing surface are drawn from one distribution rather than two
 *  invented ones. Integer-only in, rounded out. */
function buildTicks(): { ticks: Tick[]; index: number } {
  const ticks: Tick[] = [];
  let total = 0;
  for (let i = 0; i < TICKS; i++) {
    const score = 15 + Math.round((((i * 37 + 11) % 100) * 0.7));
    total += score;
    // -90° puts tick 0 at the top; the ring then reads clockwise like any instrument.
    const rad = ((i * (360 / TICKS) - 90) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const outer = R_INNER + REACH_MIN + (score / 100) * REACH_SPAN;
    ticks.push({
      score,
      // Rounded to 2dp: these are trig outputs, which are implementation-defined and drift in the
      // last ULP between Node and the browser — enough to fail hydration on a stringified attribute.
      x1: Math.round((C + cos * R_INNER) * 100) / 100,
      y1: Math.round((C + sin * R_INNER) * 100) / 100,
      x2: Math.round((C + cos * outer) * 100) / 100,
      y2: Math.round((C + sin * outer) * 100) / 100,
      color: scoreHex(score),
    });
  }
  return { ticks, index: Math.round(total / TICKS) };
}

export function OrgIndexInstrument({ size = 260, className = "" }: { size?: number; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const { ticks, index } = useMemo(() => buildTicks(), []);
  const level = levelForScore(index);

  return (
    <svg
      viewBox={`0 0 ${BOX} ${BOX}`}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={`An illustrative organization of ${TICKS} repositories, each drawn as a tick sized and coloured by its maturity, with a fleet index of ${index} — level ${level.id}, ${level.name}.`}
    >
      {/* the quiet baseline the ticks stand on */}
      <circle cx={C} cy={C} r={R_INNER} fill="none" stroke="#101a2e" strokeWidth={1.5} />

      {ticks.map((t, i) => (
        <motion.line
          key={i}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke={t.color}
          strokeWidth={3}
          strokeLinecap="round"
          // The ticks sweep in clockwise, one after another — the dial being populated repo by repo,
          // which is exactly what a fleet scan does. `opacity` is not a transform, so `MotionConfig
          // reducedMotion="user"` does NOT degrade it: gate it here explicitly (the same trap
          // documented on FleetGrid's scan line and DimensionMatrix's bars).
          initial={reduced ? false : { opacity: 0 }}
          whileInView={{ opacity: 0.92 }}
          viewport={{ once: false, margin: "-10%" }}
          transition={reduced ? { duration: 0 } : { duration: 0.32, delay: 0.15 + i * 0.012 }}
        />
      ))}

      {/* centre: the index the ring adds up to, and the level band it lands in */}
      <text x={C} y={C - 4} textAnchor="middle" className="font-mono" fontSize={44} fontWeight={700} fill="#e2e8f0">
        {index}
      </text>
      <text x={C} y={C + 18} textAnchor="middle" className="font-mono uppercase" fontSize={9} letterSpacing={2} fill="#64748b">
        Org index
      </text>
      <text x={C} y={C + 38} textAnchor="middle" className="font-mono uppercase" fontSize={9} letterSpacing={2} fill={scoreHex(index)}>
        {level.id} · {level.name}
      </text>
    </svg>
  );
}
