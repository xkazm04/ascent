// MISSION-CONTROL LANES — the hero's budgets, in one place (registry `motion/taste-budgets`: a budget
// is a named constant beside the presets it governs, never a number re-typed at a call site).
//
// Every gesture below is driven by a REAL pulse event — a file first touched, a diff that changed, a
// phase change, a landing — or by the page clock `now` (the deadline ring, the activity decay), which
// the shell freezes on a stale pulse. There is no loop, no shimmer and no spinner anywhere in the hero.

import type { CSSProperties } from "react";

// ── motion budget ────────────────────────────────────────────────────────────────────────────────
/** A file chip's entrance: slides in from the strip's newest edge. Entrance class, once per identity. */
export const CHIP_ENTER_S = 0.42;
export const CHIP_TRAVEL_PX = 28;
/** Older chips shuffling over to make room (a layout move caused by the same arrival). */
export const CHIP_LAYOUT_S = 0.36;
export const CHIP_EXIT_S = 0.28;
/** A chip's opacity settling — its entrance fade, and each second's step of its freshness decay. */
export const CHIP_FADE_S = 0.6;
/** The phase word swapping: enters decelerating, exits a step faster (`taste-budgets`). */
export const PHASE_ENTER_S = 0.34;
export const PHASE_EXIT_S = 0.2;
/** A diff figure rolling to its new value. */
export const TICK_S = 0.3;
/** The stage rail sliding to the newly lit stop. */
export const STAGE_S = 0.5;
/** The band washing into / out of its Landed state. */
export const LANDED_WASH_S = 0.7;
/** Enters decelerate; the one expressive curve is not used here (landings are the shell's to celebrate). */
export const EASE_ENTER: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const EASE_EXIT: [number, number, number, number] = [0.7, 0, 0.84, 0];

// ── honesty clocks ───────────────────────────────────────────────────────────────────────────────
/** A lane that landed keeps its band in the Landed state this long after the landing, then clears. */
export const LANDED_HOLD_MS = 30_000;
/** An agent sub-phase (reading / editing / thinking) is shown at least this long before the word
 *  swaps to another agent sub-phase — the tail alternates every few seconds and a 100-px word that
 *  flickers cannot be read from across the room. Stage changes and "quiet" are never held. */
export const PHASE_MIN_SHOW_MS = 6_000;
/** Activity glow: full at an event's moment, gone by this age. A silent lane visibly cools. */
export const ACTIVITY_DECAY_MS = 60_000;
/** The file strip shows this many chips, newest first; the oldest few fade toward the edge. */
export const STRIP_VISIBLE = 8;
/** Opacity of the chip at each position (newest first). Positions past the table use the last. */
export const STRIP_FADE: readonly number[] = [1, 1, 1, 0.92, 0.78, 0.6, 0.42, 0.26];

// ── type that reads from three metres at 1080p AND 2160p ────────────────────────────────────────
// The house type scale is fixed px (BRAND.md), tuned for a desk. A wall screen needs size that grows
// with the screen, so these are the one deliberate exception: a viewport-proportional size with the
// house size as its floor, scaled down by lane density so six lanes still fit.

type Fluid = { vw: number; min: number; max: number };
export const TYPE = {
  repo: { vw: 2.8, min: 28, max: 120 },
  phase: { vw: 4.2, min: 37, max: 180 },
  meta: { vw: 1.1, min: 17, max: 46 },
  chip: { vw: 0.92, min: 15, max: 38 },
  diff: { vw: 1.9, min: 25, max: 80 },
  ringClock: { vw: 1.45, min: 21, max: 62 },
  label: { vw: 0.64, min: 12, max: 26 },
  ringSub: { vw: 0.78, min: 13, max: 32 },
  row: { vw: 1.02, min: 17, max: 44 },
  empty: { vw: 2.4, min: 31, max: 104 },
} as const satisfies Record<string, Fluid>;

/** Every band — and the empty slot — shares one grid, so phase words line up down the screen. */
export const BAND_COLUMNS = "minmax(0,22fr) minmax(0,54fr) minmax(0,24fr)";

export const RING_SIZE: Fluid = { vw: 8.4, min: 120, max: 340 };

export function fluid(f: Fluid, scale = 1): string {
  return `clamp(${Math.round(f.min * scale)}px, ${(f.vw * scale).toFixed(2)}vw, ${Math.round(f.max * scale)}px)`;
}

export const fs = (f: Fluid, scale = 1): CSSProperties => ({ fontSize: fluid(f, scale) });

/** Lane density → type scale: two lanes read huge, six still fit the slot. */
export function densityScale(lanes: number): number {
  if (lanes <= 2) return 1;
  if (lanes <= 3) return 0.84;
  if (lanes <= 4) return 0.72;
  return 0.6;
}
