// WHICH ARM THE HEADER NAMES — one line, pure, so the choice is a rule rather than a habit.
//
// The arm belongs to a LANE (`LanePulse.arm`), not to the pulse: a `compare` run races two to four
// arms over the same batch, so "the run's arm" is not a thing such a run has. The header names the
// arm of the lane it is already reporting on in NOW — the busiest working lane — so the label and
// the sentence above it describe the same piece of work. On a `single` run that is the run's one
// arm, which is what an operator who never opened the Arms panel expects to read.
//
// Null when nothing is working, and null for a lane recorded before arms existed: `armLabel` renders
// NOTHING for it rather than "default", because its configuration is genuinely unknown.

import type { Arm } from "@/lib/local/arm";
import type { LoopPulse } from "@/lib/local/runner-types";
import { busiestLane } from "./theaterHeaderModel";

export function theaterArm(pulse: LoopPulse | null): Arm | null {
  if (!pulse) return null;
  return busiestLane(pulse.lanes)?.arm ?? null;
}
