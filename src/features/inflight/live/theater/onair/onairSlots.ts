// WHO IS ON WHICH MONITOR — the program pick and the preview slots, as pure state.
//
// PROGRAM stays on a lane while it works and cuts only when that lane goes back to planning (a plan
// has no file on its camera yet) or leaves: then to the busiest lane that is reading, editing,
// checking or landing. One cut per lane cycle, never a ping-pong.
// PREVIEWS are sticky: a lane keeps its slot for as long as it is in the pulse and off program, a
// freed slot is filled by the next lane without moving anyone else, so no monitor jumps between
// pulses. The one move there is is the cut itself (the new program leaves its preview, the old one
// takes the freed slot) — which is what a cut is.

import type { LanePulse, LoopPulse } from "@/lib/local/runner-types";
import { busiestLane } from "../theaterHeaderModel";
import { EMPTY_ONAIR, foldOnAir, type OnAirAcc } from "./onairAccumulate";
import { laneWorking, onCamera } from "./onairStages";

export const PREVIEW_SLOTS = 3;

export interface OnAirSlots {
  pgm: string | null;
  pvw: readonly (string | null)[];
  /** How many program cuts the screen has watched — keys the wipe, so it plays once per cut. */
  cuts: number;
}

export const EMPTY_SLOTS: OnAirSlots = { pgm: null, pvw: Array.from({ length: PREVIEW_SLOTS }, () => null), cuts: 0 };

export function pickProgram(lanes: readonly LanePulse[], currentId: string | null): LanePulse | null {
  const cur = lanes.find((l) => l.laneId === currentId) ?? null;
  if (cur && onCamera(cur.phase)) return cur;
  const best = busiestLane(lanes.filter((l) => onCamera(l.phase)));
  if (best) return best;
  if (cur && laneWorking(cur.phase)) return cur;
  return busiestLane(lanes) ?? lanes[0] ?? null;
}

export function assignSlots(prev: OnAirSlots, lanes: readonly LanePulse[]): OnAirSlots {
  const pgm = pickProgram(lanes, prev.pgm)?.laneId ?? null;
  const others = lanes.filter((l) => l.laneId !== pgm).map((l) => l.laneId);
  const pvw = prev.pvw.map((id) => (id != null && others.includes(id) ? id : null));
  for (const id of others) {
    if (pvw.includes(id)) continue;
    const free = pvw.indexOf(null);
    if (free >= 0) pvw[free] = id;
  }
  const cuts = prev.pgm != null && pgm != null && pgm !== prev.pgm ? prev.cuts + 1 : prev.cuts;
  return { pgm, pvw, cuts };
}

/** Everything the wall remembers across pulses. */
export interface OnAirMemory {
  at: string | null;
  acc: OnAirAcc;
  slots: OnAirSlots;
}

export const EMPTY_MEMORY: OnAirMemory = { at: null, acc: EMPTY_ONAIR, slots: EMPTY_SLOTS };

/** Fold one pulse into the wall's memory. Idempotent for a pulse already folded (same `at`). */
export function stepMemory(prev: OnAirMemory, pulse: LoopPulse | null): OnAirMemory {
  if (!pulse || pulse.at === prev.at) return prev;
  return { at: pulse.at, acc: foldOnAir(prev.acc, pulse), slots: assignSlots(prev.slots, pulse.lanes) };
}
