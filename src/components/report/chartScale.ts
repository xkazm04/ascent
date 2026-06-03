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
  return (v) => top + span * (1 - v / 100);
}

/**
 * An index → x-pixel scale across `count` points within `[left, left + width]`. A single point (or
 * none) is centered so a one-scan chart renders a dot in the middle rather than at the left edge.
 */
export function xScale(count: number, left: number, width: number): (i: number) => number {
  return (i) => (count < 2 ? left + width / 2 : left + (width * i) / (count - 1));
}
