// The hero trace for VARIANT B (Fault Lines): 12 weeks of fleet AI-authored share plotted against
// fleet rework rate, with the widening gap between them shaded as accumulated stress. Dependency-free
// SVG on the brand tokens (divider gridlines, mono axis type, accent + overdue-orange series).
// Entrance-only motion — the container fades in; nothing loops.

import { OVERDUE_ACCENT } from "@/components/org/shared/backlogShared";
import { Kicker } from "@/components/ui";
import type { DebtFleet } from "./debtModel";
import { pct } from "./debtModel";

export interface FleetWeek {
  weeksAgo: number;
  aiAuthoredShare: number;
  reworkRate: number;
}

/** Churn-weighted fleet mean per week — the same weighting the fleet headline rates use. */
export function fleetSeries(fleet: DebtFleet): FleetWeek[] {
  const rows = fleet.rows;
  if (rows.length === 0) return [];
  const churn = rows.reduce((s, r) => s + r.q.churnPerWeek, 0) || 1;
  return rows[0]!.q.series.map((_, i) => ({
    weeksAgo: rows[0]!.q.series[i]!.weeksAgo,
    aiAuthoredShare: rows.reduce((s, r) => s + r.q.series[i]!.aiAuthoredShare * r.q.churnPerWeek, 0) / churn,
    reworkRate: rows.reduce((s, r) => s + r.q.series[i]!.reworkRate * r.q.churnPerWeek, 0) / churn,
  }));
}

const W = 720;
const H = 200;
const PAD = { l: 34, r: 12, t: 10, b: 24 };

export function DebtFaultTrace({ series }: { series: FleetWeek[] }) {
  if (series.length === 0) return null;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (i / (series.length - 1)) * innerW;
  const y = (v: number) => PAD.t + innerH - v * innerH;
  const path = (pick: (p: FleetWeek) => number) =>
    series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");

  const stress =
    path((p) => p.aiAuthoredShare) +
    " " +
    series
      .slice()
      .reverse()
      .map((p, i) => `L${x(series.length - 1 - i).toFixed(1)},${y(p.reworkRate).toFixed(1)}`)
      .join(" ") +
    " Z";

  const now = series[series.length - 1]!;
  const then = series[0]!;
  const widened = now.aiAuthoredShare - now.reworkRate - (then.aiAuthoredShare - then.reworkRate);

  return (
    <figure className="animate-fade-in rounded-2xl border border-divider bg-surface-strong/40 p-4">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <Kicker>Fleet stress trace · 12 weeks</Kicker>
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
          gap {widened >= 0 ? "widening" : "closing"} {Math.abs(Math.round(widened * 100))} pp
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Fleet AI-authored share ${pct(now.aiAuthoredShare)} versus rework rate ${pct(now.reworkRate)} over the last 12 weeks`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--color-divider)" strokeDasharray="2 4" />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill="#475569" className="font-mono">
              {Math.round(t * 100)}
            </text>
          </g>
        ))}
        <path d={stress} fill={OVERDUE_ACCENT} opacity={0.12} />
        <path d={path((p) => p.reworkRate)} fill="none" stroke={OVERDUE_ACCENT} strokeWidth={2} />
        <path d={path((p) => p.aiAuthoredShare)} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
        {series.map((p, i) =>
          i % 3 === 0 || i === series.length - 1 ? (
            <text key={p.weeksAgo} x={x(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="#475569" className="font-mono">
              {p.weeksAgo === 0 ? "now" : `-${p.weeksAgo}w`}
            </text>
          ) : null,
        )}
        <circle cx={x(series.length - 1)} cy={y(now.aiAuthoredShare)} r={3.5} fill="var(--color-accent)" />
        <circle cx={x(series.length - 1)} cy={y(now.reworkRate)} r={3.5} fill={OVERDUE_ACCENT} />
      </svg>
    </figure>
  );
}
