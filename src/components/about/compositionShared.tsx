// Shared primitives for the /about Remotion compositions (champion network + risk radar). Both
// compositions had independently declared an identical `mono` font stack, a `clamp01` helper, and a
// `Metric({ label, value, color })` overlay tile whose JSX/inline-styles were byte-for-byte the same —
// the metric tiles are deliberately uniform across both diagrams. Single-sourced here so the
// composition-space typography (the load-bearing 60/30 sizes that render in 960×540 then downscale)
// can't drift between the two. Remotion components are plain React, so no client/runtime concern.

export const MONO = "var(--font-mono), ui-monospace, monospace";

/** /about diagram palette — the Remotion compositions render frame-state DOM/SVG that can't read CSS
 *  custom properties, so the brand colors are re-declared here as TS constants, PINNED to the tokens
 *  in src/app/globals.css (change BOTH together, like lib/site's BRAND_INK). The HTML legends beside
 *  each Player (ChampionNetwork, RiskRadar) consume these SAME constants, so a legend swatch can
 *  never desynchronize from the composition color it explains. */
export const ACCENT = "#3b9eff"; //        --color-accent
export const ACCENT_SOFT = "#7bbcff"; //   --color-accent-soft
export const ACCENT_FAINT = "#cfe6ff"; //  pulse-dot / champion-outline highlight (no CSS token)
export const WEAK = "#f87171"; //          weak-link / downtrend red (red-400)
export const DANGER = "#ef4444"; //        --color-danger
export const WARN = "#f97316"; //          --color-warn
export const GREEN = "#22c55e"; //         mitigated / gate-pass green (green-500)
export const INK = "#080d1a"; //           --color-ink (composition canvas background)

/** Shared playback envelope for the /about Remotion diagrams — the champion network and the risk radar
 *  both render on one 960×540 canvas at 30fps and play a single ~11s shot (no loop). Single-sourced so
 *  the two Players can't drift out of canvas scale or timing. */
export const W = 960;
export const H = 540;
export const FPS = 30;
export const DURATION = 330;

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Parse a `#rrggbb` string into an [r,g,b] triple. Module-private — only `lerpHex` (below) needs it. */
function hexToRgb(h: string): [number, number, number] {
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
