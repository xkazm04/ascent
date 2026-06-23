// Shared primitives for the /about Remotion compositions (champion network + risk radar). Both
// compositions had independently declared an identical `mono` font stack, a `clamp01` helper, and a
// `Metric({ label, value, color })` overlay tile whose JSX/inline-styles were byte-for-byte the same —
// the metric tiles are deliberately uniform across both diagrams. Single-sourced here so the
// composition-space typography (the load-bearing 60/30 sizes that render in 960×540 then downscale)
// can't drift between the two. Remotion components are plain React, so no client/runtime concern.

export const MONO = "var(--font-mono), ui-monospace, monospace";

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Parse a `#rrggbb` string into an [r,g,b] triple. */
export function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Channel-wise linear interpolation between two `#rrggbb` colors, returning an `rgb(r,g,b)` string.
 *  Both /about compositions had their own copy of this (one pre-baked its endpoints as RGB arrays). */
export function lerpHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}

/** A metric overlay tile: a large tabular-nums value over a small uppercase label. */
export function Metric({ label, value, color }: { label: string; value: React.ReactNode; color: string }) {
  // Sizes are in the 960×540 composition space; the Player scales it to ~half that, so these render
  // at roughly text-base+ — keep everything large enough to stay legible after the downscale.
  return (
    <div>
      <div style={{ color, fontSize: 60, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{value}</div>
      <div style={{ color: "#94a3b8", fontSize: 30, letterSpacing: 2, textTransform: "uppercase", marginTop: 8 }}>{label}</div>
    </div>
  );
}
