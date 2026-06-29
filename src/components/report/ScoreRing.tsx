"use client";

// Dependency-free SVG charts (keeps the bundle small and the build fast).

import { useId } from "react";
import type { MaturityLevel } from "@/lib/types";
import { LEVEL_GLYPH, scoreHex } from "@/lib/ui";
import { CHART_INK, clamp01to100 } from "@/components/report/chartScale";

export function ScoreRing({
  score,
  level,
  size = 200,
}: {
  score: number;
  level: MaturityLevel;
  size?: number;
}) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // Clamp + NaN-guard: a NaN/out-of-range score would make strokeDashoffset NaN and render the
  // ring as a full circle (reads as a perfect 100). scoreHex already clamps the colour; clamp the
  // geometry too so the arc length can't lie.
  const safeScore = clamp01to100(score);
  const offset = c * (1 - safeScore / 100);
  const color = scoreHex(score);
  const cx = size / 2;
  const titleId = useId();
  const descId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
    >
      {/* Screen-reader title/desc — the arc length already encodes the score without color. */}
      <title id={titleId}>Overall maturity score</title>
      <desc id={descId}>{`Score ${score} of 100. Level ${level.id} ${level.name}.`}</desc>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={CHART_INK.grid} strokeWidth={stroke} />
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: "stroke-dashoffset 0.8s ease" }}
      />
      <text x={cx} y={cx - 6} textAnchor="middle" className="fill-white" fontSize={size * 0.26} fontWeight={700}>
        {score}
      </text>
      <text x={cx} y={cx + 22} textAnchor="middle" fill={color} fontSize={size * 0.085} fontWeight={600}>
        {LEVEL_GLYPH[level.id]} {level.id} · {level.name}
      </text>
    </svg>
  );
}
