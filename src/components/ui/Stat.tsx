// Stat — the canonical number block: a mono kicker label, a big tabular-nums value, and optional
// delta / goal lines. Borderless (compose inside a Surface for a tile). One source of truth for the
// org dashboard Tiles, the landing stat ledger, and any headline metric.

import { deltaHex, fmtDelta } from "./format";

export interface StatProps {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
  /** Period-over-period change as an arrowed badge under the value. null/undefined hides it. */
  delta?: number | null;
  deltaLabel?: string;
  /** Active goal: target + a precomputed pace verdict (label + color). */
  goal?: { target: number; label: string; color: string };
  className?: string;
}

export function Stat({ label, value, sub, color = "#fff", delta, deltaLabel, goal, className = "" }: StatProps) {
  return (
    <div className={className}>
      <div className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-3xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && <div className="mt-1 text-sm text-slate-500">{sub}</div>}
      {delta != null && (
        <div className="mt-1.5 flex items-center gap-1.5 font-mono text-sm">
          <span style={{ color: deltaHex(delta) }}>{fmtDelta(delta)}</span>
          {deltaLabel && <span className="text-slate-500">{deltaLabel}</span>}
        </div>
      )}
      {goal && (
        <div className="mt-1 font-mono text-sm" style={{ color: goal.color }} title={`Active goal target: ${goal.target}`}>
          target {goal.target} · {goal.label}
        </div>
      )}
    </div>
  );
}
