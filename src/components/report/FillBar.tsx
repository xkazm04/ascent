"use client";

// The report's canonical "colored fill on a slate-800 rounded track" bar, as a small client island
// so SERVER components (PosturePanel) get the same motion contract the client charts share:
// mount-grow via fillBarStyle, staggered per row, and a straight snap under prefers-reduced-motion.
// PosturePanel's AxisBar previously hand-rolled this with a bare `transition-all` — animating every
// property, for reduced-motion users too, and with no entrance grow while every neighboring report
// bar animates in (score-charts-visuals #5).

import { fillBarStyle, useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";

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
    <div className={className}>
      <div
        className="h-full rounded-full"
        style={{ backgroundColor: color, ...fillBarStyle({ pct, index, mounted, reduced }) }}
      />
    </div>
  );
}
