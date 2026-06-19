// The canonical red→green maturity ramp, reshaped for SVG gradients + chart fills. Sourced from
// LEVEL_HEX (src/lib/ui.ts) so the prototypes can never drift from the rubric's level colors.

import { LEVELS } from "@/lib/maturity/model";
import { LEVEL_HEX } from "@/lib/ui";
import type { LevelId } from "@/lib/types";

/** Ordered gradient stops (0→1) across the 5 levels, red (L1) → green (L5). */
export const RAMP_STOPS = LEVELS.map((l, i) => ({
  offset: LEVELS.length > 1 ? i / (LEVELS.length - 1) : 0,
  color: LEVEL_HEX[l.id],
  id: l.id,
}));

export function levelHex(id: LevelId | string): string {
  return LEVEL_HEX[id as LevelId] ?? LEVEL_HEX.L1;
}

/** The midpoint of a level's band — the natural y-position for that level on an ascent profile. */
export function bandMid(band: readonly [number, number]): number {
  return Math.round((band[0] + band[1]) / 2);
}
