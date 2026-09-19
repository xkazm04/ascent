// The canonical red→green maturity ramp, reshaped for SVG gradients + chart fills. Sourced from
// LEVEL_HEX (src/lib/ui.ts) so the prototypes can never drift from the rubric's level colors.

import { LEVELS, LEVEL_BY_ID } from "@/lib/maturity/model";
import { LEVEL_HEX } from "@/lib/ui";

/** Ordered gradient stops (0→1) across the 5 levels, red (L1) → green (L5). */
export const RAMP_STOPS = LEVELS.map((l, i) => ({
  offset: LEVELS.length > 1 ? i / (LEVELS.length - 1) : 0,
  color: LEVEL_HEX[l.id],
  id: l.id,
}));

/** The midpoint of a level's band — the natural y-position for that level on an ascent profile. */
export function bandMid(band: readonly [number, number]): number {
  return Math.round((band[0] + band[1]) / 2);
}

/**
 * The boundary the trajectory chart's dashed line marks: the floor of L4, the rung where agents move
 * from the keyboard into the process. Both the value and the label are read from the model, so a
 * re-banding moves the line and relabels it in one step.
 *
 * The line used to be drawn at `POSTURE_THRESHOLD` (50) and labelled "AI-NATIVE", which was wrong on
 * both axes at once: POSTURE_THRESHOLD is the cut on the ADOPTION and RIGOR axes (a repo is AI-Native
 * when BOTH clear 50, model.ts:504-512), while the chart's Y axis is the weighted 0–100 index — and 50
 * on the index sits INSIDE L3 (band 45–64), so a reader who crossed the line as the copy invited them
 * to had gone precisely nowhere. `levelRamp.test.ts` pins that it stays a real band floor.
 */
const AGENT_LEVEL = LEVEL_BY_ID.L4;
export const AGENT_BAND = {
  level: AGENT_LEVEL,
  floor: AGENT_LEVEL.band[0],
  label: `${AGENT_LEVEL.id} · ${AGENT_LEVEL.name.toUpperCase()}`,
};
