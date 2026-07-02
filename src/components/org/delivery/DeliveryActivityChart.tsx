"use client";

// The delivery tab's commit-activity chart, rebuilt as a real chart instead of a row of hover-title
// divs: capped bar widths with a 2px surface gap and rounded data-ends, hairline solid gridlines on
// clean y-ticks, real week dates on the x-axis (anchored by endWeekStartMs from getOrgActivity), a
// direct label on the peak week only, and a hover/keyboard tooltip per week. A momentum row (weekly
// avg · peak · last 4 weeks vs the 4 before) turns the shape into a statement, and a <details> table
// twin keeps every value reachable without a pointer. Single series → brand accent, no legend.

import { useState } from "react";
import { deltaHex } from "@/components/ui";

const WEEK_MS = 7 * 86_400_000;

// Fixed drawing frame (viewBox units). Height includes the x-axis band so labels never clip.
const W = 920;
const H = 216;
const M = { left: 46, right: 10, top: 22, bottom: 26 };
const INNER_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const BASE_Y = M.top + PLOT_H;

const ACCENT = "#3b9eff";
const ACCENT_LIFT = "#7bbcff";

const fmtWeek = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtWeekYear = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Snap a raw step up to the nearest "nice" 1/2/5×10^k so y-ticks land on clean numbers. */
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/** Bar path: square at the baseline, radius-r rounded data-end (top). */
function barPath(x: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  const top = BASE_Y - h;
  return `M${x},${BASE_Y} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + w - r},${top} Q${x + w},${top} ${x + w},${top + r} L${x + w},${BASE_Y} Z`;
}

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
  const xOf = (i: number) => M.left + i * slot + (slot - barW) / 2;
  const centerOf = (i: number) => M.left + i * slot + slot / 2;

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
      {/* Momentum readout — the interpretation, not just the shape. */}
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Weekly avg</div>
          <div className="mt-0.5 font-mono text-lg font-bold text-white">{weeklyAvg.toLocaleString()}</div>
        </div>
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Peak week</div>
          <div className="mt-0.5 font-mono text-lg font-bold text-white">
            {peakVal.toLocaleString()}
            <span className="ml-2 text-sm font-normal text-slate-500">{fmtWeek.format(weekMs(peak))}</span>
          </div>
        </div>
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Last 4 weeks</div>
          <div className="mt-0.5 font-mono text-lg font-bold text-white">
            {last4.toLocaleString()}
            {momentum != null && (
              <span className="ml-2 text-sm font-normal" style={{ color: deltaHex(momentum) }}>
                {momentum > 0 ? "▲" : momentum < 0 ? "▼" : "→"}
                {momentum > 0 ? "+" : ""}
                {momentum}% vs prior 4
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="relative mt-4" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="group" aria-label={`Weekly commit activity, ${n} weeks`}>
          {/* gridlines + y ticks: solid hairlines, recessive */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + INNER_W} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? "#334155" : "#1e293b"} strokeWidth={1} />
              <text x={M.left - 8} y={yOf(t) + 3.5} textAnchor="end" className="fill-slate-500 font-mono" fontSize={11}>
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
              x={M.left + i * slot}
              y={M.top}
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
              left: `${(centerOf(hover) / W) * 100}%`,
              top: `${(Math.min(yOf(hoverVal), BASE_Y - 8) / H) * 100}%`,
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

      {/* table twin: every value reachable without hover (and for screen readers / print) */}
      <details className="group mt-2">
        <summary className="focus-ring inline-flex cursor-pointer list-none items-center gap-2 rounded font-mono text-sm text-slate-500 transition hover:text-slate-300 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="inline-block text-slate-600 transition-transform group-open:rotate-90">›</span>
          Table view
        </summary>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-divider">
          <table className="w-full text-sm">
            <caption className="sr-only">Weekly commit totals, newest first</caption>
            <thead className="bg-surface/60 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
              <tr>
                <th className="px-4 py-1.5 text-left">Week of</th>
                <th className="px-4 py-1.5 text-right">Commits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {series
                .map((v, i) => ({ v, i }))
                .reverse()
                .map(({ v, i }) => (
                  <tr key={i} className="text-slate-300">
                    <td className="px-4 py-1 font-mono">{fmtWeekYear.format(weekMs(i))}</td>
                    <td className="px-4 py-1 text-right font-mono tabular-nums">{v.toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
