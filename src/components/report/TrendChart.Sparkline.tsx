"use client";

// Tiny inline trend line for a single dimension's score history — extracted from TrendChart.tsx
// (co-located) to keep that file within the 300-LOC limit. Behavior is unchanged.

import { scoreHex } from "@/lib/ui";
import { ChartTooltip, PointTooltip, useChartHover } from "@/components/report/chartHover";
import { vScale, xScale } from "@/components/report/chartScale";
import type { TrendPoint } from "@/components/report/TrendChart";

/** Tiny inline trend line for a single dimension's score history (0..100 scale). */
export function Sparkline({
  points,
  width = 132,
  height = 34,
}: {
  points: TrendPoint[];
  width?: number;
  height?: number;
}) {
  const x = xScale(points.length, 0, width);
  const y = vScale(height, 3, 3);
  const hover = useChartHover(points.map((_, i) => x(i)), width);

  if (points.length === 0) return null;
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`)
    .join(" ");
  const last = points[points.length - 1]!.score; // safe: length > 0 (guarded above)
  const a = hover.active;

  return (
    <div className="relative inline-block leading-none">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden
        style={{ touchAction: "none" }}
        onPointerMove={hover.onPointerMove}
        onPointerLeave={hover.onPointerLeave}
      >
        {/* Reference line at the L4 (Advanced) threshold — a real band edge, not an arbitrary 50. */}
        <line x1={0} x2={width} y1={y(65)} y2={y(65)} stroke="var(--color-divider)" strokeWidth={1} strokeDasharray="2 3" />
        {points.length > 1 && <path d={path} fill="none" stroke={scoreHex(last)} strokeWidth={1.75} />}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.score)}
            r={i === points.length - 1 ? 2.75 : 1.75}
            fill={scoreHex(p.score)}
          />
        ))}
        {a !== null && (
          <g>
            <line x1={x(a)} x2={x(a)} y1={0} y2={height} stroke="#475569" strokeWidth={1} strokeDasharray="2 2" />
            <circle cx={x(a)} cy={y(points[a]!.score)} r={3.25} fill={scoreHex(points[a]!.score)} stroke="var(--color-surface-strong)" strokeWidth={1.25} />
          </g>
        )}
        <rect x={0} y={0} width={width} height={height} fill="transparent" />
      </svg>
      {a !== null && (
        // safe: a is a valid index into points (from useChartHover over points); a > 0 guards a-1
        <ChartTooltip xFrac={x(a) / width} yFrac={y(points[a]!.score) / height}>
          <PointTooltip
            score={points[a]!.score}
            at={points[a]!.at}
            engine={points[a]!.engine}
            delta={a > 0 ? points[a]!.score - points[a - 1]!.score : null}
          />
        </ChartTooltip>
      )}
    </div>
  );
}
