"use client";

// One small multiple of the Delivery trend (G7-09): a single metric's day-by-day line.
//
// SMALL MULTIPLES, not one six-series chart. Six overlapping lines would need a six-hue categorical
// palette; the honest color check (OKLab ΔE under simulated deutan/protan vision) can't clear six
// hues at this lightness, and two of the metrics aren't even in the same unit as the other four
// (hours vs percent), which would have forced a dual y-axis — the single worst chart mistake there
// is. One panel per metric: identity is carried by the panel's own title, so no legend is needed and
// no reader has to tell two hues apart. Every panel therefore uses the same brand accent.
//
// A `null` day is a GAP in the line, never a 0 — "nobody measured review coverage that day" is not
// "review coverage was 0%", and bridging through zero would draw a crash-and-recover that never
// happened. Mock-engine days are drawn HOLLOW, matching DimLine: a deterministic, model-free scan is
// not comparable to a live-scored one and a solid dot would assert that it is.

import { CHART_INK, linScale, xScale } from "@/components/report/chartScale";
import { ChartTooltip, useChartHover } from "@/components/report/chartHover";
import { deltaHex, fmtDelta } from "@/components/ui";

const ACCENT = "#3b9eff";

// A point's `date` is a canonical-zone DAY KEY ("2026-07-14"), not an instant. `shortDateSafe` would
// parse it as UTC midnight and format it in the VIEWER's zone — printing "Jul 13" west of Greenwich
// and, worse, disagreeing between the server prerender and the client hydration. Pin the formatter to
// UTC and en-US so the label is exactly the day key it came from, everywhere.
const fmtDayKey = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
function dayLabel(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? key : fmtDayKey.format(d);
}

/** One day of one metric, plus the sample size behind it (disclosed in the tooltip). */
export interface TrendPanelPoint {
  date: string;
  value: number | null;
  mock: boolean;
  scans: number;
  repos: number;
}

const W = 320;
const H = 84;
const PAD_TOP = 8;
const PAD_BOTTOM = 8;

/** Snap a raw max up to a "nice" 1/2/5×10^k so the hours axis lands on a readable ceiling. */
function niceMax(raw: number): number {
  if (!(raw > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

export function DeliveryTrendPanel({
  label,
  help,
  unit,
  points,
  higherIsBetter = true,
}: {
  label: string;
  /** One line under the title saying exactly what is measured — no metric without a definition. */
  help: string;
  unit: "%" | "h";
  points: TrendPanelPoint[];
  /** False for duration metrics (time-to-merge), where a FALLING line is the good news. */
  higherIsBetter?: boolean;
}) {
  const present = points.map((p, i) => ({ ...p, i })).filter((p): p is TrendPanelPoint & { value: number; i: number } => p.value !== null);
  const x = xScale(points.length, 4, W - 8);
  const domainMax = unit === "%" ? 100 : niceMax(Math.max(...present.map((p) => p.value), 1));
  const y = linScale(domainMax, H - PAD_BOTTOM, -(H - PAD_TOP - PAD_BOTTOM));

  const hover = useChartHover(present.map((p) => x(p.i)), W);
  const act = hover.active !== null ? present[hover.active] : undefined;

  const first = present[0];
  const last = present[present.length - 1];
  const delta = first && last && present.length > 1 ? Math.round((last.value - first.value) * 10) / 10 : null;
  // Color follows GOODNESS, not sign: for time-to-merge a negative delta is the improvement, so the
  // tone is read off the inverted value while the printed number keeps its true sign.
  const toneValue = delta === null ? 0 : higherIsBetter ? delta : -delta;

  const fmt = (v: number) => (unit === "%" ? `${Math.round(v)}%` : `${v}h`);

  // Break the path wherever a day has no measurement.
  let path = "";
  let pen = false;
  for (let i = 0; i < points.length; i++) {
    const v = points[i]?.value;
    if (v == null) {
      pen = false;
      continue;
    }
    path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
  }

  return (
    <div className="rounded-xl border border-divider bg-surface/40 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm uppercase tracking-widest text-slate-400">{label}</span>
        {last && (
          <span className="font-mono text-lg font-bold tabular-nums text-white">{fmt(last.value)}</span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">{help}</p>

      {present.length === 0 ? (
        <div
          className="mt-3 flex aspect-[320/84] w-full items-center justify-center rounded-lg border border-dashed border-divider text-sm text-slate-500"
          role="img"
          aria-label={`${label}: no measurements in this period`}
        >
          no sample in this period
        </div>
      ) : (
        <div className="relative mt-3">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label={`${label} over time, ${present.length} day${present.length === 1 ? "" : "s"} measured`}
            style={{ touchAction: "none" }}
            onPointerMove={hover.onPointerMove}
            onPointerDown={hover.onPointerMove}
            onPointerLeave={hover.onPointerLeave}
          >
            {/* Recessive frame: a baseline and a mid reference so the line reads as quantitative. */}
            <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke={CHART_INK.grid} strokeWidth={1} />
            <line x1={0} x2={W} y1={y(domainMax / 2)} y2={y(domainMax / 2)} stroke={CHART_INK.grid} strokeWidth={1} strokeDasharray="2 4" />
            <text x={2} y={y(domainMax / 2) - 2} fontSize={8} className="fill-slate-600">
              {fmt(domainMax / 2)}
            </text>
            {act && <line x1={x(act.i)} x2={x(act.i)} y1={0} y2={H} stroke={CHART_INK.crosshair} strokeWidth={1} strokeDasharray="3 3" />}
            {present.length > 1 && <path d={path.trim()} fill="none" stroke={ACCENT} strokeWidth={2} />}
            {present.map((p) =>
              p.mock ? (
                <circle key={p.i} data-mock cx={x(p.i)} cy={y(p.value)} r={3} fill="var(--color-surface-strong)" stroke={ACCENT} strokeWidth={1.75} />
              ) : (
                <circle key={p.i} cx={x(p.i)} cy={y(p.value)} r={2.5} fill={ACCENT} />
              ),
            )}
            {act && <circle cx={x(act.i)} cy={y(act.value)} r={5} fill="none" stroke={ACCENT} strokeWidth={1.75} />}
            <rect x={0} y={0} width={W} height={H} fill="transparent" />
          </svg>

          {act && (
            <ChartTooltip xFrac={x(act.i) / W} yFrac={y(act.value) / H}>
              <div className="text-sm">
                <div className="font-mono text-base font-bold tabular-nums text-white">{fmt(act.value)}</div>
                <div className="mt-0.5 text-sm text-slate-300">{dayLabel(act.date)}</div>
                {/* Sample size, always — a point built from one scan is a claim about one repo. */}
                <div className="text-sm text-slate-500">
                  {act.scans} scan{act.scans === 1 ? "" : "s"} · {act.repos} repo{act.repos === 1 ? "" : "s"}
                </div>
                {act.mock && <div className="text-sm text-slate-500">demo scans only (no model graded this day)</div>}
              </div>
            </ChartTooltip>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-sm">
        {delta === null ? (
          <span className="text-slate-500">one measured day: no change to read</span>
        ) : (
          <span style={{ color: deltaHex(toneValue) }}>
            {fmtDelta(delta)}
            {unit === "%" ? "pts" : "h"} across the period
          </span>
        )}
        <span className="text-slate-600">
          {present.length} day{present.length === 1 ? "" : "s"} measured
        </span>
      </div>

      {/* Every value reachable without a pointer (and for assistive tech / print). */}
      <ul className="sr-only">
        {present.map((p) => (
          <li key={p.i}>
            {label} {fmt(p.value)} on {dayLabel(p.date)} from {p.scans} scan{p.scans === 1 ? "" : "s"}
            {p.mock ? " (demo scans only: deterministic rubric, no model)" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
