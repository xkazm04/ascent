// The goal card's trajectory line — the metric's per-day fleet average drawn toward the target,
// answering "are we actually moving?" where the meter alone showed absolute standing (the documented
// pct trade-off in src/lib/db/plan.ts: no creation-time baseline, so only a trend can show travel).
// Server-safe pure SVG, no deps, same spirit as fleet/repositories/Sparkline.tsx. Renders nothing
// below 2 points — a single scan day has no direction to draw.

import type { SeriesPoint } from "@/lib/maturity/forecast";

const W = 240;
const H = 36;
const PAD = 2;

export function GoalTrend({
  series,
  target,
  color,
  className = "",
}: {
  series: SeriesPoint[];
  target: number;
  color: string;
  className?: string;
}) {
  if (series.length < 2) return null;

  // Y spans the data AND the target so the target line is always inside the frame — a goal far
  // above today's scores must render as visible headroom, not clip away the very gap being tracked.
  const values = series.map((p) => p.value);
  const lo = Math.min(...values, target);
  const hi = Math.max(...values, target);
  const span = Math.max(hi - lo, 1);
  const x = (i: number) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);

  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const targetY = y(target);
  const first = series[0]!;
  const last = series[series.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`h-9 w-full ${className}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Trend from ${first.value} (${first.date}) to ${last.value} (${last.date}), target ${target}`}
    >
      <line x1={PAD} x2={W - PAD} y1={targetY} y2={targetY} stroke="#64748b" strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.7} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(series.length - 1)} cy={y(last.value)} r={2.2} fill={color} />
    </svg>
  );
}
