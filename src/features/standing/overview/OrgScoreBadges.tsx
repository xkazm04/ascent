// Compact header-panel stat strip for the org Overview — the same headline numbers the large Tile
// grid showed (maturity · adoption · rigor · repos scanned), rendered as small inline badges inside a
// single hairline panel so they read as a header summary rather than four heavy cards. Server
// component; the page builds the badge list (so goal/delta derivation stays single-sourced there).
// With `trend`, the org-maturity history rides along as an inline sparkline (hover for per-point
// values) — replacing the full-width "over time" card that spent a whole viewport row on one line.

import { Sparkline, type TrendPoint } from "@/components/report/TrendChart";
import { scoreHex } from "@/lib/ui";

export interface ScoreBadge {
  label: string;
  value: string | number;
  color?: string;
  /** Small qualifier after the value, e.g. "L4 · Systematic". */
  sub?: string;
  /** Period-over-period change; null/0/undefined hides the arrow. */
  delta?: number | null;
  /** What the delta is measured AGAINST, e.g. "vs 30d ago" — rendered beside the arrow and spoken in
   *  the sr text. An arrow without its basis is a number the reader cannot place. */
  deltaLabel?: string;
  /** Tooltip on the value — what the number was measured over (its denominator, and what it excluded). */
  title?: string;
  /** Small trailing chip disclosing an exclusion, e.g. "3 mock (excluded from avg)". */
  note?: string;
  /** Active goal on this metric: target + a precomputed pace verdict (label + color). */
  goal?: { target: number; label: string; color: string };
}

export function OrgScoreBadges({
  badges,
  trend,
}: {
  badges: ScoreBadge[];
  /** Org-maturity history for the inline sparkline; omit (or pass <2 points) to hide it. */
  trend?: { points: TrendPoint[]; label: string };
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-divider bg-surface/40 px-5 py-3.5">
      {badges.map((b) => (
        <div key={b.label} className="flex flex-col gap-0.5">
          <span className="type-label tracking-widest text-slate-500">{b.label}</span>
          <div className="flex items-baseline gap-2">
            <span
              className="type-title font-bold tabular-nums"
              style={{ color: b.color ?? scoreHex(50) }}
              title={b.title}
            >
              {b.value}
            </span>
            {b.sub && <span className="type-body-sm text-slate-400">{b.sub}</span>}
            {b.delta != null && b.delta !== 0 && (
              <span className="type-caption">
                <span
                  className={b.delta > 0 ? "text-emerald-400" : "text-red-400"}
                  title="Cohort-matched movement: measured only over repositories scanned on both sides of the period"
                  aria-hidden
                >
                  {b.delta > 0 ? "▲" : "▼"}
                  {Math.abs(b.delta)}
                </span>
                {/* The basis, VISIBLE — not only in a tooltip, which is no disclosure on touch. */}
                {b.deltaLabel && <span className="ml-1 text-slate-500">{b.deltaLabel}</span>}
                <span className="sr-only">
                  {b.delta > 0 ? "up" : "down"} {Math.abs(b.delta)} points {b.deltaLabel ?? "this period"}
                </span>
              </span>
            )}
            {b.note && (
              // The exclusion is disclosed beside the number it changed, not only in the tooltip:
              // a hover is not a disclosure on touch, and the cohort card in the same scroll prints
              // this chip in these words.
              <span className="type-caption text-slate-500" title={b.title}>
                {b.note}
              </span>
            )}
            {b.goal && (
              <span className="type-caption" style={{ color: b.goal.color }}>
                goal {b.goal.target} · {b.goal.label}
              </span>
            )}
          </div>
        </div>
      ))}
      {trend && trend.points.length >= 2 && (
        <div className="ml-auto flex flex-col gap-0.5">
          <span className="type-label tracking-widest text-slate-500">Trend · {trend.label}</span>
          <Sparkline points={trend.points} />
        </div>
      )}
    </div>
  );
}
