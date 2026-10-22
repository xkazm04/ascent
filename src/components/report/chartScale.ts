// Shared scale + band plumbing for the dependency-free SVG charts (TrendChart, Sparkline,
// DimLine). Each chart previously re-derived the same 0..100 y-scale, index→x mapping, and level
// band/gridline definitions inline; centralizing them here is composition over duplication and
// keeps every chart's bands in lockstep with the maturity ramp. Pure functions, no React; the only
// import is the rubric (@/lib/maturity/model, pure and client-safe, as AltimeterGauge proves).

import type { LevelId } from "@/lib/types";
import { LEVEL_BY_ID, LEVELS } from "@/lib/maturity/model";

/** The shading tint per level. Only the COLOR lives here; every band edge is read from the rubric
 *  (LEVELS, the source AltimeterGauge's strata and the score colors read), so a band retune in the
 *  rubric moves every chart instead of leaving a hand-typed copy behind. */
const BAND_TINT: Record<LevelId, string> = {
  L5: "rgba(34,197,94,0.10)",
  L4: "rgba(132,204,22,0.08)",
  L3: "rgba(234,179,8,0.07)",
  L2: "rgba(249,115,22,0.06)",
  L1: "rgba(239,68,68,0.05)",
};

/** Maturity level bands (top→bottom, L5→L1) shaded behind the overall-score chart. */
export const LEVEL_BANDS: readonly { min: number; color: string }[] = [...LEVELS]
  .reverse()
  .map((l) => ({ min: l.band[0], color: BAND_TINT[l.id] }));

/** Score values where the level bands meet (every level's floor, plus the 100 cap), ascending -
 *  used for y-gridlines/labels. */
export const BAND_EDGES: readonly number[] = Array.from(new Set([...LEVELS.map((l) => l.band[0]), 100])).sort(
  (a, b) => a - b,
);

/** The L4 (Integrated) floor: the explorer's "at Integrated or above" count and the sparklines'
 *  reference line both read it. */
export const L4_FLOOR: number = LEVEL_BY_ID.L4.band[0];

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

/**
 * Provenance ink — the two neutral witnesses behind a blended dimension score, shared by the
 * ProvenanceTrack ribbon and the radar's hover ticks: the deterministic signal (slate-400, drawn as
 * an unfilled mark) and the model's raw judgment (slate-300, drawn as a filled dot). One definition
 * so "same marks on both charts" is a fact the code keeps, not a comment's promise.
 */
export const PROVENANCE_INK = {
  signal: "#94a3b8", // detector / deterministic signal (slate-400)
  llm: "#cbd5e1", // model judgment before clamp + blend (slate-300)
} as const;
