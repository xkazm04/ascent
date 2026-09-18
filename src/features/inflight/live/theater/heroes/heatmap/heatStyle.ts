// HEAT → PAINT, and the heat map's motion budget, in one place (`motion/taste-budgets`).
//
// Two hues and nothing else carry meaning on the map: COOL azure (`--color-accent`) is a file the
// agent READ, WARM orange (`--color-warn`) a file it EDITED. Intensity is time since the newest touch
// — a touch halves its glow every `HEAT_HALF_LIFE_MS` — so a lane that stops touching files visibly
// cools, and at `PHASE_QUIET_MS` (the moment the phase word says "Still working — quiet") every tile
// it touched is under a twentieth: cold. Cold is not blank: a read file keeps a faint cool hairline
// ("explored"), an edited one a warm ember ("changed"), because both are still true.
//
// Colours are mixed from the brand tokens with CSS `color-mix`, so there is no raw hex here.

import type { CSSProperties } from "react";
import type { FileHeat, TouchKind } from "./heatTypes";

/** A touch halves its glow every 20 s: the file it is on now outshines the one it left a minute ago. */
export const HEAT_HALF_LIFE_MS = 20_000;
/** The cursor ("it is HERE") marks the newest touch only while it is this fresh; after, no claim. */
export const CURSOR_MS = 30_000;
/** The trail joins the last few files touched, in order, while each is this fresh. */
export const TRAIL_MS = 45_000;
export const TRAIL_MAX = 5;
/** Below this the glow is off (it would be a smudge, not a signal). */
export const GLOW_FLOOR = 0.08;

// ── motion budget — every figure a moving thing on the map may spend ──────────────────────────────
/** Decay is re-painted on the clock's one-second tick; the transition spans the tick so it reads as
 *  one continuous cooling instead of a staircase. Stops when the clock stops (a stale pulse). */
export const DECAY_TRANSITION_MS = 1_000;
/** A new file makes room on the map (transition class): tiles slide to their new places once. */
export const REFLOW_MS = 450;
/** An edit's burn ring (feedback class): one ring per fresh edit, at most this many at once. */
export const BURN_RING_WINDOW_MS = 1_800;
export const MAX_BURN_RINGS = 3;
/** A landing's stamp (celebratory class): big for this long, then a small resting badge. */
export const STAMP_HOLD_MS = 6_000;
/** The stamp's entrance only plays inside this window after the landing was seen (one-shot). */
export const STAMP_ENTER_MS = 1_200;

const HUE: Record<TouchKind, string> = { read: "var(--color-accent)", edit: "var(--color-warn)" };

/** 0..1 — 1 at the moment of the touch, halving every half-life; 0 when the time is unknown. */
export function heat(at: number | null, now: number): number {
  if (at == null) return 0;
  return Math.pow(0.5, Math.max(0, now - at) / HEAT_HALF_LIFE_MS);
}

/** The touch that colours a file: its newest one with a known time, else what it ever was. */
export function fileTone(f: FileHeat, now: number): { kind: TouchKind; h: number } {
  const e = heat(f.editAt, now);
  const r = heat(f.readAt, now);
  return r > e ? { kind: "read", h: r } : { kind: f.edited ? "edit" : "read", h: e };
}

/** Label brightness follows the heat; an ember stays legible. Classes, not colours, so tokens rule. */
export function cellTextClass(f: FileHeat, now: number): string {
  const { h } = fileTone(f, now);
  return h > 0.55 ? "text-white" : h > 0.2 || f.edited ? "text-slate-200" : "text-slate-400";
}

const mix = (hue: string, pct: number, base = "var(--color-surface)") =>
  `color-mix(in oklab, ${hue} ${Math.round(Math.max(0, Math.min(100, pct)))}%, ${base})`;

/** The paint of one file cell. `ember` keeps an edited file warm-edged after it cools. */
export function cellPaint(f: FileHeat, now: number, reducedMotion: boolean): CSSProperties {
  const { kind, h } = fileTone(f, now);
  const hue = HUE[kind];
  const ember = f.edited;
  const floor = ember ? 14 : 6;
  const style: CSSProperties = {
    backgroundColor: mix(hue, floor + (kind === "edit" ? 78 : 70) * h),
    borderColor: mix(hue, (ember ? 55 : 22) + 45 * h, "var(--color-divider)"),
    boxShadow: h > GLOW_FLOOR ? `0 0 ${Math.round(8 + 30 * h)}px ${Math.round(1 + 5 * h)}px ${mix(hue, 60 * h, "transparent")}` : "none",
  };
  if (!reducedMotion) {
    style.transition = [
      `background-color ${DECAY_TRANSITION_MS}ms linear`,
      `border-color ${DECAY_TRANSITION_MS}ms linear`,
      `box-shadow ${DECAY_TRANSITION_MS}ms linear`,
      `left ${REFLOW_MS}ms ease-out`,
      `top ${REFLOW_MS}ms ease-out`,
      `width ${REFLOW_MS}ms ease-out`,
      `height ${REFLOW_MS}ms ease-out`,
    ].join(", ");
  }
  return style;
}

/** A module tile's edge: tinted by its hottest file, so a busy folder is findable before its cells. */
export function modulePaint(files: readonly FileHeat[], now: number, reducedMotion: boolean): CSSProperties {
  let best = { kind: "read" as TouchKind, h: 0 };
  for (const f of files) {
    const t = fileTone(f, now);
    if (t.h > best.h) best = t;
  }
  const style: CSSProperties = { borderColor: mix(HUE[best.kind], 10 + 70 * best.h, "var(--color-divider)") };
  if (!reducedMotion) {
    style.transition = `border-color ${DECAY_TRANSITION_MS}ms linear, left ${REFLOW_MS}ms ease-out, top ${REFLOW_MS}ms ease-out, width ${REFLOW_MS}ms ease-out, height ${REFLOW_MS}ms ease-out`;
  }
  return style;
}

/** The hottest heat a module carries, for its label's brightness. */
export function moduleHeat(files: readonly FileHeat[], now: number): number {
  return files.reduce((m, f) => Math.max(m, fileTone(f, now).h), 0);
}
