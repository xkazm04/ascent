// The sky's colours — brand tokens and the Tailwind palette the theater shell already speaks (the
// header's amber, the rail's success-soft), never a raw hex. One azure family for looking (planning,
// reading, proving), one warm amber for CHANGING code (the only warm thing in a working sky, so an
// edit reads from across the room), success green only for landing, slate for waiting and rest.
//
// `text-*` classes exist for gradients: an SVG <stop> takes `stop-color: currentColor`, and the
// gradient inherits `color` from the class on it — the one way to feed a token into a gradient.

import type { SkyTone } from "./skyModel";
import type { ParticleKind } from "./skyTail";

export const TONE_FILL: Record<SkyTone, string> = {
  plan: "fill-accent",
  read: "fill-accent-soft",
  edit: "fill-amber-300",
  think: "fill-slate-200",
  quiet: "fill-slate-500",
  prove: "fill-accent",
  land: "fill-success-soft",
  held: "fill-amber-300",
  error: "fill-danger",
  wait: "fill-slate-300",
  rest: "fill-slate-500",
  attention: "fill-amber-300",
  past: "fill-slate-600",
};

export const TONE_COLOR: Record<SkyTone, string> = {
  plan: "text-accent",
  read: "text-accent-soft",
  edit: "text-amber-300",
  think: "text-slate-200",
  quiet: "text-slate-500",
  prove: "text-accent",
  land: "text-success-soft",
  held: "text-amber-300",
  error: "text-danger",
  wait: "text-slate-300",
  rest: "text-slate-500",
  attention: "text-amber-300",
  past: "text-slate-600",
};

/** The phase word's colour on a big label — a touch brighter than the body where the body is dim. */
export const TONE_TEXT: Record<SkyTone, string> = {
  ...TONE_FILL,
  quiet: "fill-slate-400",
  rest: "fill-slate-400",
  past: "fill-slate-500",
};

export const PARTICLE_FILL: Record<ParticleKind, string> = {
  edit: "fill-amber-300",
  read: "fill-accent-soft",
  other: "fill-slate-300",
};

export const NOTE_FILL = {
  calm: "fill-slate-400",
  attention: "fill-amber-300",
  bad: "fill-danger",
  muted: "fill-slate-500",
} as const;

/** The gradient families the sky defines once (glow halos under nuclei). */
export const GLOW_TONES: readonly SkyTone[] = ["plan", "read", "edit", "think", "quiet", "land", "held", "error"];
export const glowTone = (t: SkyTone): SkyTone => (GLOW_TONES.includes(t) ? t : t === "prove" ? "plan" : "quiet");

/** Legible SVG type over lines and particles: an ink stroke painted UNDER the fill. */
export const INK_HALO = { paintOrder: "stroke", stroke: "var(--color-ink)", strokeWidth: 7, strokeLinejoin: "round" } as const;
