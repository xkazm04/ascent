// Stat — the canonical number block: a mono label, a bold tabular-nums value, and optional delta /
// goal lines. Borderless (compose inside a Tile ledger cell or any panel). One source of truth for
// the org dashboard Tiles and any headline metric.
//
// Label legibility: labels here run a step larger and brighter than the Kicker eyebrow
// (13px / 0.12em / slate-400 vs 12px / 0.22em / slate-500) — at Kicker's tracking, multi-word metric
// labels wrapped to ragged two-liners and read as texture, not text. The tighter tracking keeps
// every fleet-tile label on one line at the 4-across breakpoint, which is what keeps a row of
// values horizontally aligned.

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
      <div className="font-mono text-[13px] uppercase leading-snug tracking-[0.12em] text-slate-400">{label}</div>
      <div className="mt-0.5 font-mono text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-sm text-slate-500">{sub}</div>}
      {delta != null && (
        <div className="mt-1 flex items-center gap-1.5 font-mono text-sm">
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
