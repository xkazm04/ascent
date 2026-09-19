// Shared scale + band plumbing for the dependency-free SVG charts (TrendChart, Sparkline,
// DimLine). Each chart previously re-derived the same 0..100 y-scale, index→x mapping, and level
// band/gridline definitions inline; centralizing them here is composition over duplication and
// keeps every chart's bands in lockstep with the maturity ramp. Pure functions — no React.

/** Maturity level bands (top→bottom) shaded behind the overall-score chart. */
export const LEVEL_BANDS = [
  { min: 85, color: "rgba(34,197,94,0.10)" }, // L5
  { min: 65, color: "rgba(132,204,22,0.08)" }, // L4
  { min: 45, color: "rgba(234,179,8,0.07)" }, // L3
  { min: 25, color: "rgba(249,115,22,0.06)" }, // L2
  { min: 0, color: "rgba(239,68,68,0.05)" }, // L1
] as const;

/** Score values where the level bands meet — used for y-gridlines/labels. */
export const BAND_EDGES = [0, 25, 45, 65, 85, 100] as const;

/**
 * A 0..100 score → y-pixel scale for a chart of `height` with `top`/`bottom` insets. Higher score
 * sits higher (smaller y). Returned as a closure so callers keep their terse `yFor(score)` call.
 */
export function vScale(height: number, top: number, bottom: number): (v: number) => number {
  const span = height - top - bottom;
  // Clamp + NaN-guard at the scale boundary: an unvalidated history point (a NaN or out-of-range
  // score from a drifted/bad /api/history body) would otherwise produce a NaN y — silently breaking
  // the whole <path> — or a point plotted outside the chart box. Every chart routes through vScale,
  // so one guard protects them all. (scoreHex already clamps colour; the geometry didn't.)
  return (v) => {
    const c = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
    return top + span * (1 - c / 100);
  };
}

/**
 * Clamp a value into 0..100 with the same NaN-guard `vScale` uses: a NaN/out-of-range score collapses
 * to 0 rather than propagating a NaN downstream. The single guard the radial charts (ScoreRing) reuse.
 */
export function clamp01to100(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
}

/**
 * A generic `0..domainMax → pixel` linear scale: `rangeStart + (clamped / domainMax) * rangeLen`, with
 * the same clamp + NaN-guard as `vScale` (value clamped to `[0, domainMax]`; a NaN → 0). The radial/
 * track charts (PostureQuadrant, ProvenanceTrack) previously hand-rolled this closure inline and DROPPED
 * the guard; routing through `linScale` restores it. Pass a negative `rangeLen` (with `rangeStart` at the
 * far edge) for an inverted axis, e.g. a y-axis where a higher value sits higher.
 */
export function linScale(domainMax: number, rangeStart: number, rangeLen: number): (v: number) => number {
  return (v) => {
    const c = Number.isFinite(v) ? Math.max(0, Math.min(domainMax, v)) : 0;
    return rangeStart + (c / domainMax) * rangeLen;
  };
}

/**
 * An index → x-pixel scale across `count` points within `[left, left + width]`. A single point (or
 * none) is centered so a one-scan chart renders a dot in the middle rather than at the left edge.
 */
export function xScale(count: number, left: number, width: number): (i: number) => number {
  return (i) => (count < 2 ? left + width / 2 : left + (width * i) / (count - 1));
}

/**
 * Per-band rect geometry for the shaded maturity bands, derived from a chart's y-scale. A band's top
 * edge is the previous (higher) band's floor — or 100 for the topmost — and it runs down to its own
 * `min`; the height is clamped at 0 so a degenerate scale can't produce a negative rect. Returned in
 * the same top→bottom order as `LEVEL_BANDS` (so callers can still index for an L-id label). Both
 * TrendChart and DimLine map over this for their own `<rect>` (their own x/width, optional labels),
 * keeping the fiddly `i === 0 ? 100 : prev.min` "top of band" math in lockstep across charts.
 */
export function levelBandRects(
  y: (v: number) => number,
): { min: number; top: number; height: number; color: string }[] {
  return LEVEL_BANDS.map((band, i) => {
    const top = y(i === 0 ? 100 : LEVEL_BANDS[i - 1]!.min); // safe: i > 0 here, i-1 in-bounds
    const bottom = y(band.min);
    return { min: band.min, top, height: Math.max(0, bottom - top), color: band.color };
  });
}

/**
 * Chart-chrome ink — the non-data stroke/fill colors shared across the dependency-free SVG charts
 * (gridlines, hover crosshair, point outlines, the dark canvas behind a point). Centralized so a
 * palette retune happens in one place instead of drifting across ~10 chart files. Data colors (the
 * red→green score ramp via `scoreHex`, the level bands) live elsewhere; these are chrome only.
 */
export const CHART_INK = {
  grid: "#1e293b", // gridlines / ring track / axis + plot-frame / baseline-track stroke (slate-800 · --color-divider)
  crosshair: "#475569", // hover crosshair stroke (slate-600)
  crosshairDash: "#334155", // dashed threshold crosshair (slate-700)
  pointStroke: "#020617", // point outline on the dark canvas (slate-950 · --color-surface-strong)
  canvas: "#0b1322", // the dark canvas/surface behind a point (matches ui.ts heatCell background)
} as const;
