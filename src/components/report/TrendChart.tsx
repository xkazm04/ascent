"use client";

// Dependency-free SVG line chart of overall score over time. Bands shade the maturity
// levels so you can see when a repo crosses a level boundary. A thin hover layer
// (chartHover) adds a crosshair + tooltip without any charting dependency.

import { scoreHex } from "@/lib/ui";
import { ChartTooltip, PointTooltip, useChartHover } from "@/components/report/chartHover";

export interface TrendPoint {
  score: number;
  at: string; // ISO
  engine?: string; // provider that produced this scan, when known (omitted for org rollups)
}

const BANDS = [
  { min: 85, color: "rgba(34,197,94,0.10)" }, // L5
  { min: 65, color: "rgba(132,204,22,0.08)" }, // L4
  { min: 45, color: "rgba(234,179,8,0.07)" }, // L3
  { min: 25, color: "rgba(249,115,22,0.06)" }, // L2
  { min: 0, color: "rgba(239,68,68,0.05)" }, // L1
];

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
  const x = (i: number) =>
    points.length === 1 ? width / 2 : (width * i) / (points.length - 1);
  const y = (v: number) => height - 3 - ((height - 6) * v) / 100;
  const hover = useChartHover(points.map((_, i) => x(i)), width);

  if (points.length === 0) return null;
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`)
    .join(" ");
  const last = points[points.length - 1].score;
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
        <line x1={0} x2={width} y1={y(50)} y2={y(50)} stroke="#1e293b" strokeWidth={1} strokeDasharray="2 3" />
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
            <circle cx={x(a)} cy={y(points[a].score)} r={3.25} fill={scoreHex(points[a].score)} stroke="#020617" strokeWidth={1.25} />
          </g>
        )}
        <rect x={0} y={0} width={width} height={height} fill="transparent" />
      </svg>
      {a !== null && (
        <ChartTooltip xFrac={x(a) / width} yFrac={y(points[a].score) / height}>
          <PointTooltip
            score={points[a].score}
            at={points[a].at}
            engine={points[a].engine}
            delta={a > 0 ? points[a].score - points[a - 1].score : null}
          />
        </ChartTooltip>
      )}
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const W = 640;
  const H = 220;
  const m = { top: 16, right: 44, bottom: 26, left: 28 };
  const innerW = W - m.left - m.right;
  const innerH = H - m.top - m.bottom;

  const yFor = (score: number) => m.top + innerH * (1 - score / 100);
  const xFor = (i: number) =>
    points.length === 1 ? m.left + innerW / 2 : m.left + (innerW * i) / (points.length - 1);

  const hover = useChartHover(points.map((_, i) => xFor(i)), W);
  const a = hover.active;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(p.score).toFixed(1)}`)
    .join(" ");

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Overall score over time"
        style={{ touchAction: "none" }}
        onPointerMove={hover.onPointerMove}
        onPointerLeave={hover.onPointerLeave}
      >
        {/* level bands */}
        {BANDS.map((b, i) => {
          const top = yFor(i === 0 ? 100 : BANDS[i - 1].min);
          const bottom = yFor(b.min);
          return (
            <rect key={b.min} x={m.left} y={top} width={innerW} height={Math.max(0, bottom - top)} fill={b.color} />
          );
        })}
        {/* y gridlines / labels at band edges */}
        {[0, 25, 45, 65, 85, 100].map((v) => (
          <g key={v}>
            <line x1={m.left} x2={m.left + innerW} y1={yFor(v)} y2={yFor(v)} stroke="#1e293b" strokeWidth={1} />
            <text x={m.left - 6} y={yFor(v) + 3} textAnchor="end" fontSize={9} className="fill-slate-600">
              {v}
            </text>
          </g>
        ))}
        {/* crosshair at the hovered scan */}
        {a !== null && (
          <line x1={xFor(a)} x2={xFor(a)} y1={m.top} y2={m.top + innerH} stroke="#475569" strokeWidth={1} strokeDasharray="3 3" />
        )}
        {/* line + points */}
        {points.length > 1 && <path d={linePath} fill="none" stroke="#3b9eff" strokeWidth={2.5} />}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={xFor(i)} cy={yFor(p.score)} r={i === points.length - 1 ? 5 : 3.5} fill={scoreHex(p.score)} stroke="#020617" strokeWidth={1.5} />
            {(i === 0 || i === points.length - 1 || points.length <= 6) && (
              <text x={xFor(i)} y={H - 8} textAnchor="middle" fontSize={9} className="fill-slate-500">
                {shortDate(p.at)}
              </text>
            )}
          </g>
        ))}
        {/* hovered point highlight */}
        {a !== null && (
          <circle cx={xFor(a)} cy={yFor(points[a].score)} r={6.5} fill="none" stroke={scoreHex(points[a].score)} strokeWidth={2} />
        )}
        {/* last value label */}
        {points.length > 0 && (
          <text
            x={xFor(points.length - 1) + 8}
            y={yFor(points[points.length - 1].score) + 3}
            fontSize={12}
            fontWeight={700}
            fill={scoreHex(points[points.length - 1].score)}
          >
            {points[points.length - 1].score}
          </text>
        )}
        {/* transparent capture layer so pointer moves register across the whole plot */}
        <rect x={0} y={0} width={W} height={H} fill="transparent" />
      </svg>
      {a !== null && (
        <ChartTooltip xFrac={xFor(a) / W} yFrac={yFor(points[a].score) / H}>
          <PointTooltip
            score={points[a].score}
            at={points[a].at}
            engine={points[a].engine}
            delta={a > 0 ? points[a].score - points[a - 1].score : null}
          />
        </ChartTooltip>
      )}
    </div>
  );
}
