"use client";

// An `athena:chart`, drawn as dependency-free SVG on the report charts' own scale + hover plumbing
// (`chartScale.ts`, `chartHover.tsx`). NO CHART LIBRARY: recharts appears in exactly one landing file
// in this repo and must not spread into the dashboard for a 320-pixel drawer chart.
//
// TWO THINGS THAT LOOK LIKE STYLE AND ARE NOT:
//
//  • THE DOMAIN IS SHIFTED, NOT CLAMPED. `linScale` clamps its input into `[0, domainMax]`, which is
//    correct for a 0..100 score and silently wrong for a series that dips below zero — every negative
//    would flatten onto the baseline and the picture would assert something the data never said. The
//    values are shifted by `lo` first, so what reaches `linScale` is always in range and nothing is
//    clamped away.
//
//  • THE SERIES COLOURS ARE AZURE + SLATE, NEVER THE LEVEL RAMP. The red→green ramp means L1→L5. Her
//    series are arbitrary numbers — PR counts, token spend, days — and painting a low one red would
//    invent a maturity claim out of an axis.
//
// The sr-only list under the drawing is the chart's real accessible form: a hover tooltip is a mouse
// affordance, so the values are also readable as text.

import { linScale, CHART_INK } from "@/components/report/chartScale";
import { useChartHover, ChartTooltip } from "@/components/report/chartHover";
import type { AthenaChartBlock } from "@/lib/athena/blocks";

const VB_W = 360;
const VB_H = 136;
const PAD = { left: 6, right: 6, top: 12, bottom: 22 };
const PLOT_W = VB_W - PAD.left - PAD.right;
const PLOT_H = VB_H - PAD.top - PAD.bottom;
const BASE_Y = PAD.top + PLOT_H;

/** Chart chrome, not level semantics — see the header. */
const SERIES_INK = ["#3b9eff", "#94a3b8"] as const;

const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
const short = (s: string): string => (s.length > 8 ? `${s.slice(0, 7)}…` : s);

export function AthenaChart({ block }: { block: AthenaChartBlock }) {
  const { labels, series } = block;
  const all = series.flatMap((s) => s.values);
  // Zero is kept in the domain so a bar's length stays proportional to its value; a chart whose floor
  // is the smallest bar exaggerates every difference above it.
  const lo = Math.min(0, ...all);
  const hi = Math.max(...all, lo + 1);
  const y = linScale(hi - lo, BASE_Y, -PLOT_H);
  const yFor = (v: number) => y(v - lo);

  const slot = PLOT_W / labels.length;
  const xs = labels.map((_, i) => PAD.left + slot * (i + 0.5));
  const { active, onPointerMove, onPointerLeave } = useChartHover(xs, VB_W);
  const isLine = block.chart === "line";
  const barW = Math.max(3, (slot * 0.62) / series.length);

  return (
    <div className="relative px-4">
      {block.title && (
        <div className="pb-1 font-mono text-xs uppercase tracking-widest text-slate-500">{block.title}</div>
      )}
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="block w-full"
        role="img"
        aria-label={block.title ?? `${isLine ? "Line" : "Bar"} chart`}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <line x1={PAD.left} y1={BASE_Y} x2={VB_W - PAD.right} y2={BASE_Y} stroke={CHART_INK.grid} strokeWidth={1} />
        {active !== null && (
          <line x1={xs[active]} y1={PAD.top} x2={xs[active]} y2={BASE_Y} stroke={CHART_INK.crosshair} strokeWidth={1} />
        )}
        {series.map((s, si) =>
          isLine ? (
            <g key={si}>
              <polyline
                points={s.values.map((v, i) => `${xs[i]},${yFor(v)}`).join(" ")}
                fill="none"
                stroke={SERIES_INK[si % SERIES_INK.length]}
                strokeWidth={1.75}
                strokeLinejoin="round"
              />
              {s.values.map((v, i) => (
                <circle
                  key={i}
                  cx={xs[i]}
                  cy={yFor(v)}
                  r={active === i ? 3.5 : 2}
                  fill={SERIES_INK[si % SERIES_INK.length]}
                  stroke={CHART_INK.pointStroke}
                  strokeWidth={1}
                />
              ))}
            </g>
          ) : (
            <g key={si}>
              {s.values.map((v, i) => {
                const top = yFor(v);
                const left = xs[i]! - (barW * series.length) / 2 + barW * si;
                return (
                  <rect
                    key={i}
                    x={left}
                    y={Math.min(top, BASE_Y)}
                    width={barW}
                    height={Math.max(1, Math.abs(BASE_Y - top))}
                    rx={1}
                    fill={SERIES_INK[si % SERIES_INK.length]}
                    opacity={active === null || active === i ? 1 : 0.45}
                  />
                );
              })}
            </g>
          ),
        )}
        {labels.map((l, i) => (
          <text
            key={i}
            x={xs[i]}
            y={VB_H - 7}
            textAnchor="middle"
            className="fill-slate-500 font-mono"
            style={{ fontSize: 9 }}
          >
            {short(l)}
          </text>
        ))}
      </svg>

      {active !== null && (
        <ChartTooltip xFrac={(xs[active] ?? 0) / VB_W} yFrac={0.1}>
          <div className="text-xs">
            <div className="font-mono uppercase tracking-widest text-slate-500">{labels[active]}</div>
            {series.map((s, si) => (
              <div key={si} className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-slate-400">{s.name}</span>
                <span className="font-mono tabular-nums" style={{ color: SERIES_INK[si % SERIES_INK.length] }}>
                  {fmt(s.values[active] ?? 0)}
                </span>
              </div>
            ))}
          </div>
        </ChartTooltip>
      )}

      {series.length > 1 && (
        <div className="flex flex-wrap gap-3 pt-1">
          {series.map((s, si) => (
            <span key={si} className="flex items-center gap-1.5 font-mono text-xs text-slate-500">
              <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: SERIES_INK[si % SERIES_INK.length] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}

      <ul className="sr-only">
        {series.map((s, si) => (
          <li key={si}>
            {s.name}: {labels.map((l, i) => `${l} ${fmt(s.values[i] ?? 0)}`).join(", ")}
          </li>
        ))}
      </ul>
    </div>
  );
}
