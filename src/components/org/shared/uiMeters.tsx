// Shared meter primitives for the org dashboard tabs (server-safe, no client hooks).
// Extracted from ui.tsx (which re-exports them) to keep that barrel under the 300-LOC limit.

/**
 * Meter — the shared progress bar: one track radius/height, an optional threshold marker
 * and an animated fill width. Pass `color` for a custom fill (else the brand accent).
 */
export function Meter({
  value,
  color,
  threshold,
  size = "md",
  className = "",
  ariaLabel,
}: {
  value: number;
  color?: string;
  threshold?: number;
  size?: "sm" | "md";
  className?: string;
  /** Accessible name for the progressbar. Omit only when a visible label already precedes this Meter
   *  and is programmatically associated with it (e.g. via `aria-labelledby` on a wrapping element) —
   *  MeterRow's `labelled`/`stacked` layouts render bare text next to the bar, so most call sites
   *  should pass one. */
  ariaLabel?: string;
}) {
  const h = size === "sm" ? "h-1.5" : "h-2";
  // A NaN/Infinity `value` (e.g. a done/total ratio with total === 0) must not reach `style.width` —
  // that renders as `width: NaN%`, a silently broken bar. Match the neutral treatment `fmtDelta`
  // already uses for non-finite deltas: fall back to 0 instead of propagating the NaN.
  const safeValue = Number.isFinite(value) ? value : 0;
  const pct = Math.max(0, Math.min(100, safeValue));
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`relative ${h} overflow-hidden rounded-full bg-slate-800 ${className}`}
    >
      <div
        className={`animate-meter h-full rounded-full ${color ? "" : "bg-accent"}`}
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
      {threshold != null && (
        <div className="absolute inset-y-0 w-px bg-slate-500" style={{ left: `${threshold}%` }} />
      )}
    </div>
  );
}

/**
 * A labelled `Meter` row — the "a Meter plus a numeric/percent readout" composition that the people/
 * adoption tabs each re-invented (contributors' AiBar, teams' MetricBar, adoption's DeliveryRow). One
 * component with three layouts:
 *  - `inline`    — bare Meter + a right-aligned readout (no label). The contributors AI-share bar.
 *  - `labelled`  — left label + flex Meter + right readout on one row. The adoption delivery row.
 *  - `stacked`   — a label/value header row, with the Meter beneath it. The teams metric bar.
 * Per-site class widths/colors are passed through so the rendered output stays pixel-identical.
 */
export function MeterRow({
  layout = "inline",
  value,
  display,
  label,
  color,
  threshold,
  meterClassName,
  meterSize = "sm",
  valueClassName,
  valueColor,
  labelClassName,
  ariaLabel,
}: {
  layout?: "inline" | "labelled" | "stacked";
  value: number;
  /** The readout text (defaults to the numeric value). */
  display?: React.ReactNode;
  label?: React.ReactNode;
  color?: string;
  threshold?: number;
  meterClassName?: string;
  meterSize?: "sm" | "md";
  valueClassName?: string;
  valueColor?: string;
  labelClassName?: string;
  /** Accessible name for the underlying `Meter`. Defaults to `label` when it's a plain string;
   *  `inline` layout has no on-screen label, so pass one explicitly there. */
  ariaLabel?: string;
}) {
  const readout = display ?? value;
  const meterLabel = ariaLabel ?? (typeof label === "string" ? label : undefined);
  if (layout === "stacked") {
    return (
      <div>
        <div className={labelClassName ?? "flex items-center justify-between font-mono text-sm uppercase tracking-widest text-slate-500"}>
          <span>{label}</span>
          <span style={valueColor ? { color: valueColor } : undefined}>{readout}</span>
        </div>
        <Meter className={meterClassName ?? "mt-1"} size={meterSize} value={value} color={color} threshold={threshold} ariaLabel={meterLabel} />
      </div>
    );
  }
  // inline + labelled share a single flex row; `labelled` adds a leading label cell.
  return (
    <div className={layout === "labelled" ? "flex items-center gap-3 text-sm" : "flex items-center gap-2"}>
      {layout === "labelled" && <span className={labelClassName ?? "w-36 shrink-0 text-slate-400"}>{label}</span>}
      <Meter className={meterClassName} size={meterSize} value={value} color={color} threshold={threshold} ariaLabel={meterLabel} />
      <span className={valueClassName ?? "w-9 font-mono text-sm text-slate-500"} style={valueColor ? { color: valueColor } : undefined}>
        {readout}
      </span>
    </div>
  );
}
