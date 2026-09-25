"use client";

// The wall's memory in React: folds each NEW pulse (a new `at`) exactly once — the file maps and the
// monitor slots (onairSlots.ts `stepMemory`). State is adjusted while rendering when the pulse changed
// (React's "derive from a changed prop" pattern, as `useMissionAccumulator` does), so the first paint
// of a pulse already carries its folded map and its slot assignment.

import { useState } from "react";
import type { LoopPulse } from "@/lib/local/runner-types";
import { EMPTY_MEMORY, stepMemory, type OnAirMemory } from "./onairSlots";

export function useOnAirMemory(pulse: LoopPulse | null): OnAirMemory {
  const [memory, setMemory] = useState<OnAirMemory>(() => stepMemory(EMPTY_MEMORY, pulse));
  if (pulse && memory.at !== pulse.at) {
    const next = stepMemory(memory, pulse);
    setMemory(next);
    return next;
  }
  return memory;
}
