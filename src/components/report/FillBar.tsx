"use client";

// The report's canonical "colored fill on a slate-800 rounded track" bar, as a small client island
// so SERVER components (PosturePanel) get the same motion contract the client charts share:
// mount-grow via fillBarStyle, staggered per row, and a straight snap under prefers-reduced-motion.
// PosturePanel's AxisBar previously hand-rolled this with a bare `transition-all` — animating every
// property, for reduced-motion users too, and with no entrance grow while every neighboring report
// bar animates in (score-charts-visuals #5).
//
// ScoreBarTrack/ScoreBarFill below are the same track+fill markup, split out so DimensionCard and
// ScoreWaterfall (which each need to compute `mounted`/`reduced` themselves for OTHER transitions on
// the same row, or which drive multiple segments instead of a single fill) can reuse the exact
// track/fill divs without going through FillBar's own hook calls. Each site keeps its own height/
// margin/track className — those genuinely differ between the three panels and are NOT flattened.

import { fillBarStyle, useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";

/** The shared rounded, overflow-hidden track div — height/margin/layout stay per-caller via `className`. */
export function ScoreBarTrack({
  className = "overflow-hidden rounded-full bg-slate-800",
  role,
  "aria-label": ariaLabel,
  children,
}: {
  className?: string;
  role?: string;
  "aria-label"?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className} role={role} aria-label={ariaLabel}>
      {children}
    </div>
  );
}

/** A single colored fill div, mount-grown/staggered via fillBarStyle — the non-segmented case. */
export function ScoreBarFill({
  pct,
  color,
  index = 0,
  mounted,
  reduced,
  stagger,
  cap,
}: {
  pct: number;
  color: string;
  index?: number;
  mounted: boolean;
  reduced: boolean;
  stagger?: number;
  cap?: number;
}) {
  return (
    <div
      className="h-full rounded-full"
      style={{ backgroundColor: color, ...fillBarStyle({ pct, index, mounted, reduced, stagger, cap }) }}
    />
  );
}

export function FillBar({
  pct,
  color,
  index = 0,
  className = "mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800",
}: {
  /** Fill percentage, 0–100. */
  pct: number;
  /** Fill color (any CSS color, e.g. scoreHex output). */
  color: string;
  /** Row index for the shared entrance stagger (fillBarStyle's 60ms/480ms defaults). */
  index?: number;
  /** Track classes — override to retune height/margin per surface. */
  className?: string;
}) {
  const mounted = useMounted();
  const reduced = usePrefersReducedMotion();
  return (
    <ScoreBarTrack className={className}>
      <ScoreBarFill pct={pct} color={color} index={index} mounted={mounted} reduced={reduced} />
    </ScoreBarTrack>
  );
}
