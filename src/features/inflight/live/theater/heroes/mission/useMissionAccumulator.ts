"use client";

// The accumulator's React seat: folds each NEW pulse (a new `at`) into the hero's memory exactly once.
// State is adjusted while rendering when the pulse changed — React's sanctioned "derive from a changed
// prop" pattern — so the first paint of a new pulse already carries its folded trail (no effect, no
// extra frame in which a chip exists without its one-shot decision).

import { useState } from "react";
import type { LoopPulse } from "@/lib/local/runner-types";
import { accumulate, EMPTY_ACC, type MissionAcc } from "./missionAccumulate";

export function useMissionAccumulator(pulse: LoopPulse): MissionAcc {
  const [acc, setAcc] = useState<MissionAcc>(() => accumulate(EMPTY_ACC, pulse));
  if (acc.pulseAt !== pulse.at) {
    const next = accumulate(acc, pulse);
    setAcc(next);
    return next;
  }
  return acc;
}
