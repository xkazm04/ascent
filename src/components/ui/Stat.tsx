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
  /**
   * Value color. NOT a free-for-all: pass a palette-derived hex only — the score ramp (`scoreHex`),
   * the direction triad (`deltaHex`/`DIRECTION_TONE`, paired with the `--color-tone-*` tokens), or
   * omit it for the default white. Hand-rolled hexes here are exactly the off-palette drift the
   * Kicker/Surface primitives were built to end.
   */
  color?: string;
  /** Period-over-period change as an arrowed badge under the value. null/undefined hides it. */
  delta?: number | null;
  deltaLabel?: string;
  /** Active goal: target + a precomputed pace verdict (label + color). */
  goal?: { target: number; label: string; color: string };
  /**
   * Opt out of thousands-grouping for a numeric `value`. By default a raw `number` value is rendered
   * with `.toLocaleString()` so a large count reads `4,823,019`, not `4823019` — matching every
   * `.toLocaleString()` call site. Set `raw` for an already-formatted or identifier-like number (a
   * year, an id) that must render its exact digits. Non-number values (strings/nodes) are untouched.
   */
  raw?: boolean;
  /**
   * Layout family. Only TWO shapes actually exist in the product, and they are not interchangeable:
   *
   * - `"ledger"` (default) — the dashboard form: label first, value under it. A row of these reads as
   *   comparable metrics inside a Tile ledger, where the labels have to line up before the numbers do,
   *   so the label carries the larger/brighter treatment documented at the top of this file.
   * - `"figure"` — the editorial form on the marketing deck (/about masthead): the NUMBER leads and the
   *   label reads as a caption beneath it. Inverting the order is not cosmetic — it also quiets the
   *   label a step (12px / 0.2em / slate-500), because a caption *under* a figure is subordinate to it
   *   where a label *above* a value is the thing you scan first.
   * - `"figure-compact"` — the same inverted form one density step down, for figures that sit inside a
   *   diagram rather than carrying a section (the ROI simulator's tallies): smaller value, tighter
   *   caption gap and tracking. A density step, not a fourth design.
   *
   * Anything that is neither of these shapes (the /launch pill chip, where value and label share one
   * line; the war-room's projector-scale tweened cell) legitimately keeps its own component — see the
   * notes on those files. Do not add a prop to drag them in here.
   */
  variant?: "ledger" | "figure" | "figure-compact";
  className?: string;
}

/** The two inverted (value-first) densities. Each row is one coherent typographic bundle. */
const FIGURE = {
  figure: {
    value: "font-mono text-3xl font-bold tabular-nums",
    label: "mt-1 font-mono text-xs uppercase tracking-[0.2em] text-slate-500",
  },
  "figure-compact": {
    value: "font-mono text-2xl font-bold tabular-nums",
    label: "mt-0.5 font-mono text-xs uppercase tracking-widest text-slate-500",
  },
} as const;

export function Stat({ label, value, sub, color, delta, deltaLabel, goal, raw = false, variant = "ledger", className = "" }: StatProps) {
  const display = typeof value === "number" && !raw ? value.toLocaleString() : value;
  const figure = variant === "ledger" ? null : FIGURE[variant];
  // Default value color is a class (`text-white`), not an inline `#fff` style — a real palette-derived
  // `color` prop still wins via the inline style (see the StatProps doc comment above).
  const valueClass = color ? "" : " text-white";
  const valueStyle = color ? { color } : undefined;
  return (
    <div className={className}>
      {figure ? (
        <>
          <div className={figure.value + valueClass} style={valueStyle}>
            {display}
          </div>
          <div className={figure.label}>{label}</div>
        </>
      ) : (
        <>
          <div className="font-mono text-[13px] uppercase leading-snug tracking-[0.12em] text-slate-400">{label}</div>
          <div className={`mt-0.5 font-mono text-2xl font-bold tabular-nums${valueClass}`} style={valueStyle}>
            {display}
          </div>
        </>
      )}
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
