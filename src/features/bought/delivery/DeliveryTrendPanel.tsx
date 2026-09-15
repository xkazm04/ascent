"use client";

// One small multiple of the Delivery trend (G7-09): a single metric's day-by-day line.
//
// SMALL MULTIPLES, not one six-series chart. Six overlapping lines would need a six-hue categorical
// palette; the honest color check (OKLab ΔE under simulated deutan/protan vision) can't clear six
// hues at this lightness, and two of the metrics aren't even in the same unit as the other four
// (hours vs percent), which would have forced a dual y-axis — the single worst chart mistake there
// is. One panel per metric: identity is carried by the panel's own title, so no legend is needed and
// no reader has to tell two hues apart. Every panel therefore uses the shared brand accent token
// (`DEFAULT_BASE`) rather than a hand-picked hex — BRAND.md, and §2.5 of the /org redesign.
//
// A `null` day is a GAP in the line, never a 0 (`trendPath`) — "nobody measured review coverage that
// day" is not "review coverage was 0%". That is the kit's `missing` state, and the panel now says so
// with the kit's own vocabulary: the no-sample placeholder is a `StateSwatch state="missing"` under
// `STATE_LABEL.missing`, and the footer counts the void days. Mock-engine days are drawn HOLLOW,
// matching DimLine: a deterministic, model-free scan is not comparable to a live-scored one.
//
// The metric's definition used to sit under the title as a permanent sentence. It is now a `WhyChip`
// beside the title (§2.1 D — Disclosed): present on hover/focus, absent at first sight, so the
// topmost thing under the panel's own header is the reading and then the shape.

import { CHART_INK, linScale, xScale } from "@/components/report/chartScale";
import { ChartTooltip, useChartHover } from "@/components/report/chartHover";
import { DEFAULT_BASE, STATE_LABEL, StateSwatch, WhyChip, stateTitle } from "@/components/org/viz";
import { DeliveryTrendPanelFoot } from "./DeliveryTrendPanelFoot";
import {
  TREND_H,
  TREND_PAD_BOTTOM,
  TREND_PAD_TOP,
  TREND_W,
  dayLabel,
  niceMax,
  trendPath,
  voidDays,
  type TrendPanelPoint,
} from "./deliveryTrendPanelMath";

export type { TrendPanelPoint } from "./deliveryTrendPanelMath";

const W = TREND_W;
const H = TREND_H;

export function DeliveryTrendPanel({
  label,
  help,
  unit,
  points,
  higherIsBetter = true,
}: {
  label: string;
  /** The metric's definition — disclosed through the WhyChip, never printed as standing prose. */
  help: string;
  unit: "%" | "h";
  points: TrendPanelPoint[];
  /** False for duration metrics (time-to-merge), where a FALLING line is the good news. */
  higherIsBetter?: boolean;
}) {
  const present = points
    .map((p, i) => ({ ...p, i }))
    .filter((p): p is TrendPanelPoint & { value: number; i: number } => p.value !== null);
  const x = xScale(points.length, 4, W - 8);
  const domainMax = unit === "%" ? 100 : niceMax(Math.max(...present.map((p) => p.value), 1));
  const y = linScale(domainMax, H - TREND_PAD_BOTTOM, -(H - TREND_PAD_TOP - TREND_PAD_BOTTOM));

  const hover = useChartHover(present.map((p) => x(p.i)), W);
  const act = hover.active !== null ? present[hover.active] : undefined;

  const first = present[0];
  const last = present[present.length - 1];
  const delta = first && last && present.length > 1 ? Math.round((last.value - first.value) * 10) / 10 : null;
  // Color follows GOODNESS, not sign: for time-to-merge a negative delta is the improvement, so the
  // tone is read off the inverted value while the printed number keeps its true sign.
  const toneValue = delta === null ? 0 : higherIsBetter ? delta : -delta;

  const fmt = (v: number) => (unit === "%" ? `${Math.round(v)}%` : `${v}h`);
  const voids = voidDays(points);
  const path = trendPath(points, x, y);

  return (
    <div className="rounded-xl border border-divider bg-surface/40 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className="type-mono-sm uppercase tracking-widest text-slate-400">{label}</span>
          <WhyChip hint={help} label={label} className="translate-y-0.5" />
        </span>
        {last && <span className="font-mono type-lede font-bold tabular-nums text-white">{fmt(last.value)}</span>}
      </div>

      {present.length === 0 ? (
        <div
          className="mt-3 flex aspect-[320/84] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-divider type-body-sm text-slate-500"
          role="img"
          aria-label={stateTitle("missing", label)}
        >
          <StateSwatch state="missing" />
          {STATE_LABEL.missing.toLowerCase()} in this period
        </div>
      ) : (
        <div className="relative mt-3">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label={
              `${label} over time, ${present.length} day${present.length === 1 ? "" : "s"} measured` +
              (voids > 0 ? `, ${voids} with no measurement drawn as gaps rather than zeroes` : "")
            }
            style={{ touchAction: "none" }}
            onPointerMove={hover.onPointerMove}
            onPointerDown={hover.onPointerMove}
            onPointerLeave={hover.onPointerLeave}
          >
            <title>{stateTitle(voids > 0 ? "missing" : "measured", label)}</title>
            {/* Recessive frame: a baseline and a mid reference so the line reads as quantitative. */}
            <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke={CHART_INK.grid} strokeWidth={1} />
            <line x1={0} x2={W} y1={y(domainMax / 2)} y2={y(domainMax / 2)} stroke={CHART_INK.grid} strokeWidth={1} strokeDasharray="2 4" />
            <text x={2} y={y(domainMax / 2) - 2} fontSize={8} className="fill-slate-600">
              {fmt(domainMax / 2)}
            </text>
            {act && <line x1={x(act.i)} x2={x(act.i)} y1={0} y2={H} stroke={CHART_INK.crosshair} strokeWidth={1} strokeDasharray="3 3" />}
            {present.length > 1 && <path data-line d={path} fill="none" stroke={DEFAULT_BASE} strokeWidth={2} />}
            {present.map((p) =>
              p.mock ? (
                <circle key={p.i} data-mock cx={x(p.i)} cy={y(p.value)} r={3} fill="var(--color-surface-strong)" stroke={DEFAULT_BASE} strokeWidth={1.75} />
              ) : (
                <circle key={p.i} cx={x(p.i)} cy={y(p.value)} r={2.5} fill={DEFAULT_BASE} />
              ),
            )}
            {act && <circle cx={x(act.i)} cy={y(act.value)} r={5} fill="none" stroke={DEFAULT_BASE} strokeWidth={1.75} />}
            <rect x={0} y={0} width={W} height={H} fill="transparent" />
          </svg>

          {act && (
            <ChartTooltip xFrac={x(act.i) / W} yFrac={y(act.value) / H}>
              <div className="type-body-sm">
                <div className="font-mono type-body font-bold tabular-nums text-white">{fmt(act.value)}</div>
                <div className="mt-0.5 type-body-sm text-slate-300">{dayLabel(act.date)}</div>
                {/* Sample size, always — a point built from one scan is a claim about one repo. */}
                <div className="type-body-sm text-slate-500">
                  {act.scans} scan{act.scans === 1 ? "" : "s"} · {act.repos} repo{act.repos === 1 ? "" : "s"}
                </div>
                {act.mock && <div className="type-body-sm text-slate-500">demo scans only (no model graded this day)</div>}
              </div>
            </ChartTooltip>
          )}
        </div>
      )}

      <DeliveryTrendPanelFoot label={label} fmt={fmt} present={present} delta={delta} toneValue={toneValue} unit={unit} voids={voids} />
    </div>
  );
}
