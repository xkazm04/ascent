"use client";

// The accumulator as component state — folded from each NEW pulse object during render (React's
// "storing information from previous renders" pattern: no effect, no ref read, no extra paint). The
// fold is pure, so a double render in development folds the same pulse into the same result.

import { useState } from "react";
import type { LoopPulse } from "@/lib/local/runner-types";
import { foldPulse } from "./heatFold";
import { EMPTY_HEAT, type HeatAcc } from "./heatTypes";

export function useHeatAcc(pulse: LoopPulse, now: number): HeatAcc {
  const [state, setState] = useState(() => ({ pulse, acc: foldPulse(EMPTY_HEAT, pulse, now) }));
  if (state.pulse !== pulse) {
    const next = { pulse, acc: foldPulse(state.acc, pulse, now) };
    setState(next);
    return next.acc;
  }
  return state.acc;
}
