// Shared presentational pieces for the three AI-era-debt variants. Hoisted out of the first variant
// the moment the second needed them (skill guardrail: extract shared structure mid-prototype rather
// than at refactor time). Server-safe — no hooks, no handlers.

import { Kicker } from "@/components/ui";
import { fmtDelta, deltaHex } from "@/components/org/shared/ui";
import { scoreHex, heatCell } from "@/lib/ui";
import { OVERDUE_ACCENT } from "@/components/org/shared/backlogShared";
import { pct, pct1, ppDelta, type RepoDebt } from "./debtModel";

/** The prototype's honesty label: names exactly which half of the surface is fabricated. */
export function MockNotice({ className = "" }: { className?: string }) {
  return (
    <p className={`rounded-lg border border-dashed border-divider bg-surface/40 px-3 py-2 text-sm text-slate-400 ${className}`}>
      <span className="font-mono text-xs uppercase tracking-[0.22em] text-amber-300">Mock half</span>{" "}
      Overdue debt, owners, dimensions and projected points are <strong className="font-medium text-slate-200">real</strong> backlog
      data. Rework rate, reversion rate and AI-authored churn are <strong className="font-medium text-amber-200">simulated</strong> —
      no data model exists for them yet.
    </p>
  );
}

/**
 * Pressure is 0–100 with HIGH = BAD, so it is rendered through the brand ramp INVERTED
 * (`scoreHex(100 - pressure)`): green still reads as healthy, and the ramp keeps its one meaning.
 */
export const pressureHex = (pressure: number): string => scoreHex(100 - pressure);
export const pressureCell = (pressure: number, alpha = 0.5) => heatCell(100 - pressure, alpha);

/** A rate + its period-over-period movement in percentage points, in the brand's delta tone. */
export function RateCell({
  now,
  prev,
  decimals = 0,
  label,
}: {
  now: number;
  prev: number;
  decimals?: 0 | 1;
  label?: string;
}) {
  const d = ppDelta(now, prev);
  return (
    <div className="flex flex-col">
      {label && <Kicker tone="muted">{label}</Kicker>}
      <span className="font-mono tabular-nums text-white">{decimals === 1 ? pct1(now) : pct(now)}</span>
      <span className="font-mono text-xs tabular-nums" style={{ color: deltaHex(d) }}>
        {fmtDelta(d)} pp
      </span>
    </div>
  );
}

/** Dimension chips (D1…D9) carrying a repo's overdue debt — real data, the "where" of the gap. */
export function DimChips({ dims }: { dims: string[] }) {
  if (dims.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {dims.map((d) => (
        <span key={d} className="rounded border border-divider bg-surface/60 px-1.5 py-0.5 font-mono text-xs text-slate-400">
          {d}
        </span>
      ))}
    </span>
  );
}

/** Overdue principal as a chip — points locked up + how old the debt is. */
export function PrincipalChip({ row }: { row: RepoDebt }) {
  if (row.overdue === 0) {
    return <span className="font-mono text-xs text-slate-500">no overdue debt</span>;
  }
  return (
    <span className="font-mono text-xs tabular-nums" style={{ color: OVERDUE_ACCENT }}>
      {row.overdue} overdue · {row.principal} pts · {row.avgDaysOverdue}d avg age
    </span>
  );
}

/**
 * A 12-week two-series trace: AI-authored share (accent) against rework rate (orange), with the gap
 * between them shaded. Dependency-free SVG on a 0–1 domain, sized by the caller. Entrance-only motion.
 */
export function DivergenceTrace({
  row,
  width = 220,
  height = 48,
  className = "",
}: {
  row: RepoDebt;
  width?: number;
  height?: number;
  className?: string;
}) {
  const pts = row.q.series;
  const x = (i: number) => (i / (pts.length - 1)) * width;
  const y = (v: number) => height - v * height;
  const line = (pick: (p: (typeof pts)[number]) => number) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");
  const band =
    `${line((p) => p.aiAuthoredShare)} ` +
    pts
      .slice()
      .reverse()
      .map((p, i) => `L${x(pts.length - 1 - i).toFixed(1)},${y(p.reworkRate).toFixed(1)}`)
      .join(" ") +
    " Z";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={`animate-fade-in overflow-visible ${className}`}
      role="img"
      aria-label={`${row.repoName}: AI-authored share ${pct(row.q.aiAuthoredShare)} against rework rate ${pct(row.q.reworkRate)} over 12 weeks`}
    >
      <path d={band} fill={OVERDUE_ACCENT} opacity={0.1} />
      <path d={line((p) => p.reworkRate)} fill="none" stroke={OVERDUE_ACCENT} strokeWidth={1.5} />
      <path d={line((p) => p.aiAuthoredShare)} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeOpacity={0.9} />
      <circle cx={width} cy={y(pts[pts.length - 1]!.aiAuthoredShare)} r={2.4} fill="var(--color-accent)" />
      <circle cx={width} cy={y(pts[pts.length - 1]!.reworkRate)} r={2.4} fill={OVERDUE_ACCENT} />
    </svg>
  );
}

/** The two-line legend the traces share, so each variant doesn't re-explain the colors. */
export function TraceLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-4 font-mono text-xs uppercase tracking-[0.18em] ${className}`}>
      <span className="flex items-center gap-1.5 text-slate-400">
        <span className="h-px w-4" style={{ backgroundColor: "var(--color-accent)" }} /> AI-authored share
      </span>
      <span className="flex items-center gap-1.5 text-slate-400">
        <span className="h-px w-4" style={{ backgroundColor: OVERDUE_ACCENT }} /> Rework rate
      </span>
    </div>
  );
}

/** One-line plain-language verdict for a repo — the "what's the takeaway" requirement. */
export function verdictFor(row: RepoDebt, medianRework: number): { text: string; tone: string } {
  const hot = row.q.reworkRate > medianRework;
  if (row.overdue > 0 && hot) {
    return {
      text: `Compounding — ${pct(row.q.reworkRate)} of changes reworked while ${row.overdue} fixes sit past due`,
      tone: pressureHex(row.pressure),
    };
  }
  if (hot) {
    return { text: `Rework above fleet median on ${pct(row.q.aiChurnShare)} AI-authored churn`, tone: OVERDUE_ACCENT };
  }
  if (row.overdue > 0) {
    return { text: `${row.overdue} overdue fixes, but quality is holding`, tone: "#eab308" };
  }
  return { text: `Leveraged — ${pct(row.q.aiAuthoredShare)} AI-authored, rework under the fleet median`, tone: "#22c55e" };
}
