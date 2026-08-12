// Shared presentational pieces for the AI-era-debt prototype (Debt Ledger, post-consolidation).
// Server-safe — no hooks, no handlers.

import { Kicker } from "@/components/ui";
import { fmtDelta, deltaHex } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
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
