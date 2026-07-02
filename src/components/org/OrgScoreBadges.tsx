// Compact header-panel stat strip for the org Overview — the same headline numbers the large Tile
// grid showed (maturity · adoption · rigor · repos scanned), rendered as small inline badges inside a
// single hairline panel so they read as a header summary rather than four heavy cards. Server
// component; the page builds the badge list (so goal/delta derivation stays single-sourced there).

import { scoreHex } from "@/lib/ui";

export interface ScoreBadge {
  label: string;
  value: string | number;
  color?: string;
  /** Small qualifier after the value, e.g. "L4 · Systematic". */
  sub?: string;
  /** Period-over-period change; null/0/undefined hides the arrow. */
  delta?: number | null;
  /** Active goal on this metric: target + a precomputed pace verdict (label + color). */
  goal?: { target: number; label: string; color: string };
}

export function OrgScoreBadges({ badges }: { badges: ScoreBadge[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-divider bg-surface/40 px-5 py-3.5">
      {badges.map((b) => (
        <div key={b.label} className="flex flex-col gap-0.5">
          <span className="font-mono text-xs uppercase tracking-widest text-slate-500">{b.label}</span>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold tabular-nums" style={{ color: b.color ?? scoreHex(50) }}>
              {b.value}
            </span>
            {b.sub && <span className="text-sm text-slate-400">{b.sub}</span>}
            {b.delta != null && b.delta !== 0 && (
              <span className={`font-mono text-xs ${b.delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
                {b.delta > 0 ? "▲" : "▼"}
                {Math.abs(b.delta)}
              </span>
            )}
            {b.goal && (
              <span className="font-mono text-xs" style={{ color: b.goal.color }}>
                goal {b.goal.target} · {b.goal.label}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
