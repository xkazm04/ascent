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
}: {
  value: number;
  color?: string;
  threshold?: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const h = size === "sm" ? "h-1.5" : "h-2";
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`relative ${h} overflow-hidden rounded-full bg-slate-800 ${className}`}>
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
}) {
  const readout = display ?? value;
  if (layout === "stacked") {
    return (
      <div>
        <div className={labelClassName ?? "flex items-center justify-between font-mono text-sm uppercase tracking-widest text-slate-500"}>
          <span>{label}</span>
          <span style={valueColor ? { color: valueColor } : undefined}>{readout}</span>
        </div>
        <Meter className={meterClassName ?? "mt-1"} size={meterSize} value={value} color={color} threshold={threshold} />
      </div>
    );
  }
  // inline + labelled share a single flex row; `labelled` adds a leading label cell.
  return (
    <div className={layout === "labelled" ? "flex items-center gap-3 text-sm" : "flex items-center gap-2"}>
      {layout === "labelled" && <span className={labelClassName ?? "w-36 shrink-0 text-slate-400"}>{label}</span>}
      <Meter className={meterClassName} size={meterSize} value={value} color={color} threshold={threshold} />
      <span className={valueClassName ?? "w-9 font-mono text-sm text-slate-500"} style={valueColor ? { color: valueColor } : undefined}>
        {readout}
      </span>
    </div>
  );
}
