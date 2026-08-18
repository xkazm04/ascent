"use client";

// The delivery tab's commit-activity chart, rebuilt as a real chart instead of a row of hover-title
// divs: capped bar widths with a 2px surface gap and rounded data-ends, hairline solid gridlines on
// clean y-ticks, real week dates on the x-axis (anchored by endWeekStartMs from getOrgActivity), a
// direct label on the peak week only, and a hover/keyboard tooltip per week. A momentum row (weekly
// avg · peak · last 4 weeks vs the 4 before) turns the shape into a statement, and a <details> table
// twin keeps every value reachable without a pointer. Single series → brand accent, no legend.
//
// Layout math lives in deliveryActivityChart.ts (pure, uncapped); the momentum readout and the table
// twin are extracted siblings — this file owns the hover state and the SVG itself, and stays under
// the 200-LOC cap (AGENTS.md).

import { useState } from "react";
import { ACCENT, ACCENT_LIFT, BASE_Y, CHART_H, CHART_MARGIN, CHART_W, INNER_W, PLOT_H, WEEK_MS, barPath, fmtWeek, fmtWeekYear, niceStep } from "./deliveryActivityChartMath";
import { DeliveryActivityMomentum } from "./DeliveryActivityMomentum";
import { DeliveryActivityTable } from "./DeliveryActivityTable";

export function DeliveryActivityChart({
  series,
  endWeekStartMs,
}: {
  series: number[];
  endWeekStartMs: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const n = series.length;
  const weekMs = (i: number) => endWeekStartMs - (n - 1 - i) * WEEK_MS;
  const max = Math.max(...series, 1);

  // y scale: clean ticks from 0 to the tick-rounded max.
  const step = niceStep(max / 3);
  const yMax = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let t = 0; t <= yMax; t += step) ticks.push(t);
  const yOf = (v: number) => BASE_Y - (v / yMax) * PLOT_H;

  // x layout: one slot per week; thin marks (the viewBox renders ~1.5× at typical card widths, so a
  // 16-unit cap keeps bars ≤ ~24 CSS px), ≥ 2px gap between neighbours.
  const slot = INNER_W / n;
  const barW = Math.max(1, Math.min(16, slot - 2));
  const xOf = (i: number) => CHART_MARGIN.left + i * slot + (slot - barW) / 2;
  const centerOf = (i: number) => CHART_MARGIN.left + i * slot + slot / 2;

  // Label roughly six x positions, anchored on the newest week so "this week" is always dated.
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const isLabeled = (i: number) => (n - 1 - i) % labelEvery === 0;

  const peak = series.indexOf(Math.max(...series));
  const peakVal = series[peak] ?? 0;
  const hoverVal = hover == null ? null : series[hover] ?? 0;

  // Momentum: the most recent 4 full weeks against the 4 before them.
  const last4 = series.slice(-4).reduce((a, b) => a + b, 0);
  const prev4 = series.slice(-8, -4).reduce((a, b) => a + b, 0);
  const momentum = n >= 8 && prev4 > 0 ? Math.round(((last4 - prev4) / prev4) * 100) : null;
  const weeklyAvg = Math.round(series.reduce((a, b) => a + b, 0) / Math.max(1, n));

  return (
    <div>
      <DeliveryActivityMomentum weeklyAvg={weeklyAvg} peakVal={peakVal} peakWeekMs={weekMs(peak)} last4={last4} momentum={momentum} />

      <div className="relative mt-4" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="h-auto w-full" role="group" aria-label={`Weekly commit activity, ${n} weeks`}>
          {/* gridlines + y ticks: solid hairlines, recessive */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={CHART_MARGIN.left} x2={CHART_MARGIN.left + INNER_W} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? "#334155" : "#1e293b"} strokeWidth={1} />
              <text x={CHART_MARGIN.left - 8} y={yOf(t) + 3.5} textAnchor="end" className="fill-slate-500 font-mono" fontSize={11}>
                {t.toLocaleString()}
              </text>
            </g>
          ))}

          {/* bars */}
          {series.map((v, i) =>
            v <= 0 ? null : (
              <path
                key={i}
                d={barPath(xOf(i), barW, Math.max(2, (v / yMax) * PLOT_H))}
                fill={hover === i ? ACCENT_LIFT : ACCENT}
                fillOpacity={hover == null || hover === i ? 1 : 0.55}
              />
            ),
          )}

          {/* selective direct label: the peak week only (skipped while its tooltip is up) */}
          {peakVal > 0 && hover !== peak && (
            <text x={centerOf(peak)} y={yOf(peakVal) - 6} textAnchor="middle" className="fill-slate-300 font-mono" fontSize={11}>
              {peakVal.toLocaleString()}
            </text>
          )}

          {/* x-axis week labels */}
          {series.map((_, i) =>
            isLabeled(i) ? (
              <text key={i} x={centerOf(i)} y={BASE_Y + 17} textAnchor="middle" className="fill-slate-500 font-mono" fontSize={11}>
                {fmtWeek.format(weekMs(i))}
              </text>
            ) : null,
          )}

          {/* hit layer: full-height slots (≥ the bar + its gap), hover + keyboard focus */}
          {series.map((v, i) => (
            <rect
              key={i}
              x={CHART_MARGIN.left + i * slot}
              y={CHART_MARGIN.top}
              width={slot}
              height={PLOT_H}
              fill="transparent"
              tabIndex={0}
              aria-label={`Week of ${fmtWeekYear.format(weekMs(i))}: ${v.toLocaleString()} commits`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="focus:outline-none"
            />
          ))}
        </svg>

        {/* tooltip — value leads, week follows; clamped at the edges */}
        {hover != null && hoverVal != null && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-divider bg-surface-strong/95 px-2.5 py-1.5 shadow-lg"
            style={{
              left: `${(centerOf(hover) / CHART_W) * 100}%`,
              top: `${(Math.min(yOf(hoverVal), BASE_Y - 8) / CHART_H) * 100}%`,
              transform: `translate(${hover < n * 0.12 ? "0" : hover > n * 0.88 ? "-100%" : "-50%"}, calc(-100% - 6px))`,
            }}
          >
            <div className="whitespace-nowrap font-mono text-sm font-bold text-white">
              {hoverVal.toLocaleString()} <span className="font-normal text-slate-400">commits</span>
            </div>
            <div className="whitespace-nowrap font-mono text-xs text-slate-500">week of {fmtWeek.format(weekMs(hover))}</div>
          </div>
        )}
      </div>

      <DeliveryActivityTable series={series} weekMs={weekMs} />
    </div>
  );
}
