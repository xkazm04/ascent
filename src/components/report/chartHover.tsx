"use client";

// Thin, dependency-free hover layer shared by the SVG charts. The charts stay pure SVG;
// this adds a pointer→nearest-point mapping (using the chart's own viewBox X coordinates)
// plus a floating HTML tooltip and a crosshair, without pulling in a charting library.

import { useState, type PointerEvent, type ReactNode } from "react";
import { scoreHex } from "@/lib/ui";

/**
 * Map a pointer's X to the nearest data index using the chart's own viewBox X positions —
 * the very same xFor() coordinates the chart already computes for its dots. Returns the
 * active index (or null when the pointer has left) and the handlers to spread onto the
 * chart's <svg>. We scale by the rendered width so it works regardless of how the
 * responsive (viewBox) SVG is sized on screen.
 */
export function useChartHover(xs: number[], viewBoxWidth: number) {
  const [active, setActive] = useState<number | null>(null);

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    if (xs.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const vbX = ((e.clientX - rect.left) / rect.width) * viewBoxWidth;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const dist = Math.abs(xs[i]! - vbX); // safe: i bounded by xs.length
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    setActive(best);
  }

  function onPointerLeave() {
    setActive(null);
  }

  return { active, onPointerMove, onPointerLeave };
}

/**
 * Floating tooltip anchored to a point given as fractions (0..1) of the chart container.
 * Flips horizontally near the edges and drops below the point when it's near the top, so
 * it stays within the chart. Marked aria-hidden: it's a mouse affordance, and every chart
 * already exposes its values to assistive tech via labels / the radar's data table.
 */
export function ChartTooltip({
  xFrac,
  yFrac,
  children,
}: {
  xFrac: number;
  yFrac: number;
  children: ReactNode;
}) {
  const tx = xFrac < 0.15 ? "0%" : xFrac > 0.85 ? "-100%" : "-50%";
  const below = yFrac < 0.35;
  const ty = below ? "12px" : "calc(-100% - 12px)";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20 whitespace-nowrap rounded-lg border border-divider bg-surface-strong/95 px-2.5 py-1.5 shadow-lg shadow-black/40"
      style={{ left: `${xFrac * 100}%`, top: `${yFrac * 100}%`, transform: `translate(${tx}, ${ty})` }}
    >
      {children}
    </div>
  );
}

function shortDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Standard tooltip body for a time-series point: the exact score (color-coded), the
 * scan date/time, the engine that produced it, and the delta from the prior point.
 * `delta === null` marks the first point (no prior to compare against).
 */
export function PointTooltip({
  score,
  at,
  engine,
  delta,
  label,
  sha,
  linked,
  commitLinked,
}: {
  score: number;
  at?: string;
  engine?: string;
  delta?: number | null;
  label?: string;
  /** Short commit sha this scan pinned to, shown as context. */
  sha?: string;
  /** Whether the point links somewhere (the chart opens it on click) — adds an affordance hint. */
  linked?: boolean;
  /** Whether shift-click jumps to the GitHub commit — adds the external-jump hint. */
  commitLinked?: boolean;
}) {
  return (
    <div className="text-sm">
      <div className="flex items-baseline gap-1.5">
        {label && <span className="text-slate-400">{label}</span>}
        <span className="font-mono text-base font-bold tabular-nums" style={{ color: scoreHex(score) }}>
          {score}
        </span>
      </div>
      {at && <div className="mt-0.5 text-sm text-slate-300">{shortDateTime(at)}</div>}
      {engine && <div className="text-sm text-slate-500">engine: {engine}</div>}
      {sha && <div className="font-mono text-sm text-slate-500">commit {sha}</div>}
      <div className="mt-0.5 text-sm">
        {delta == null ? (
          <span className="text-slate-500">first scan</span>
        ) : delta === 0 ? (
          <span className="text-slate-500">no change since prior</span>
        ) : (
          <span className={delta > 0 ? "font-semibold text-emerald-400" : "font-semibold text-red-400"}>
            {delta > 0 ? "▲ +" : "▼ "}
            {Math.abs(delta)} since prior
          </span>
        )}
      </div>
      {linked && <div className="mt-0.5 text-sm text-accent">click to open this scan&apos;s report →</div>}
      {commitLinked && <div className="text-sm text-slate-500">shift-click for the GitHub commit ↗</div>}
    </div>
  );
}
