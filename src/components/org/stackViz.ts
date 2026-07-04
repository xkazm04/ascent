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

/** SVG polygon `d` for per-axis fractions (0..1), each plotted on its own spoke and closed. */
export function radarPath(cx: number, cy: number, radius: number, fracs: number[]): string {
  const pts = fracs.map((f, i) => {
    const { x, y } = polarPoint(cx, cy, radius * Math.max(0, Math.min(1, f)), axisAngle(i, fracs.length));
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return `${pts.join(" ")} Z`;
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
