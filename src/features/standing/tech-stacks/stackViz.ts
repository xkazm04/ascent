// Shared, server-safe geometry + palette for the tech-stacks "Profiles" radar. Pure math + a
// categorical color ramp; no hooks, so the presentational chart can stay dependency-light and the
// orchestrator imports one source of truth for both.

/** Point on a circle: `angleDeg` measured clockwise from 3 o'clock (SVG convention). */
export function polarPoint(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
}

/** Evenly-spaced axis angle (degrees) for axis `i` of `n`, starting at the top (−90°) and going
 *  clockwise — the natural reading order for the D1…D9 spokes. */
export function axisAngle(i: number, n: number): number {
  return -90 + (360 / n) * i;
}

/**
 * The drawable geometry for one profile over per-axis fractions (0..1), where **`null` means the
 * stack carries no average for that dimension** — not a zero.
 *
 * This is the §2.4 `missing` encoding in polar form: a void is a GAP IN THE LINE, so an unmeasured
 * axis contributes no vertex, and the polygon breaks into open runs around it. The previous
 * `radarPath` took `number[]` and its caller coerced a missing average with `?? 0`, which drew the
 * profile all the way in to the centre on that spoke — a stack whose scans predate a dimension read
 * as scoring 0 on it. `fleetAnalysis.ts` has always been honest about the same rows (it filters
 * `p.value != null` so such a stack simply does not vote); the picture above it was not.
 *
 * `complete` is false as soon as one axis is void: a partial ring must not be filled, because the
 * enclosed area would be a magnitude invented out of the missing axes.
 */
export interface RadarShape {
  /** One `d` per unbroken run of measured axes. A complete profile is a single closed polygon. */
  paths: string[];
  /** True only when every axis carried a measurement — the gate on filling the shape. */
  complete: boolean;
  /** Indices of the axes with no measurement, in axis order. */
  voidAxes: number[];
}

const frac = (f: number) => Math.max(0, Math.min(1, f));

export function radarShape(cx: number, cy: number, radius: number, fracs: (number | null)[]): RadarShape {
  const n = fracs.length;
  const at = (i: number) => {
    const p = polarPoint(cx, cy, radius * frac(fracs[i]!), axisAngle(i, n));
    return `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  };
  const present = (i: number) => typeof fracs[i] === "number" && Number.isFinite(fracs[i]);
  const voidAxes = fracs.map((_, i) => i).filter((i) => !present(i));

  if (n === 0 || voidAxes.length === n) return { paths: [], complete: false, voidAxes };
  if (voidAxes.length === 0) {
    const d = fracs.map((_, i) => `${i === 0 ? "M" : "L"}${at(i)}`).join(" ");
    return { paths: [`${d} Z`], complete: true, voidAxes };
  }

  // Walk the ring starting just after a void so every run is contiguous in the traversal, then emit
  // one open polyline per run of two-or-more measured axes. A lone measured axis between two voids
  // has no line to be part of; its dot (drawn by the chart) is the whole mark.
  const start = (voidAxes[voidAxes.length - 1]! + 1) % n;
  const paths: string[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 2) paths.push(run.map((i, k) => `${k === 0 ? "M" : "L"}${at(i)}`).join(" "));
    run = [];
  };
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (present(i)) run.push(i);
    else flush();
  }
  flush();
  return { paths, complete: false, voidAxes };
}

/** SVG text-anchor for a perimeter label at `angleDeg`, so left-side labels sit end-anchored and
 *  right-side start-anchored (top/bottom stay middle) — keeps a ring of labels from colliding. */
export function labelAnchor(angleDeg: number): "start" | "middle" | "end" {
  const cos = Math.cos((angleDeg * Math.PI) / 180);
  if (cos > 0.3) return "start";
  if (cos < -0.3) return "end";
  return "middle";
}

/** `?stack=<key>` scope query (or "" for the whole fleet) — the scoped repositories/executive views. */
export function stackScopeQ(stackId: string | null): string {
  return stackId ? `?stack=${encodeURIComponent(stackId)}` : "";
}

/**
 * Categorical identity colors for the overlaid stack polygons — color means WHICH stack, radius means
 * the score, so these deliberately AVOID the red→green score ramp (a red polygon must never read as a
 * bad score). Cool + magenta hues, ordered so adjacent slots stay CVD-separable; validated for the
 * dark surface via the dataviz palette checker (lightness band, chroma floor, adjacent ΔE ≥ 12,
 * ≥ 3:1 contrast). The sidebar's labeled swatch is the secondary encoding, so identity never rests on
 * hue alone. Beyond 5 stacks the ramp cycles — the labels keep them distinct.
 */
export const STACK_COLORS = ["#3987e5", "#199e70", "#9085e9", "#d55181", "#1596b0"] as const;

export const stackColor = (i: number): string => STACK_COLORS[i % STACK_COLORS.length]!;
