"use client";

// The six dials the inspector hands the engine, as one piece of state.
//
// They were six `useState` calls in CockpitInspector, which was fine at four and stopped being fine
// when the agent's model and effort joined them: the component is an ORCHESTRATOR (selection →
// proposal → CTA) and every dial it stores itself is a line of state management standing between a
// reader and that flow. One object, one setter, one prop pair — and the run and the drive read the
// same values, which is the property that matters: they are the same experiment armed two ways.

import { useState } from "react";
import { LOOP_DEFAULT_CONCURRENCY } from "@/lib/db/loop-runs-types";
import { DRIVE_DEFAULT_MAX_RUNS } from "./driveTypes";

export interface RunDials {
  /** Work only follow-ups on this dimension, or null for all of them. */
  dimFocus: string | null;
  concurrency: number;
  cycles: number;
  /** The drive's rope. Inert for a single run — one run is one run. */
  maxRuns: number;
  /** null = the deployment's `CLAUDE_MODEL`. The server resolves it and records what it resolved. */
  model: string | null;
  /** null = no `--effort` flag at all, which is not the same as a default level. */
  effort: string | null;
}

const DEFAULT_CYCLES = 3;

export const INITIAL_DIALS: RunDials = {
  dimFocus: null,
  concurrency: LOOP_DEFAULT_CONCURRENCY,
  cycles: DEFAULT_CYCLES,
  maxRuns: DRIVE_DEFAULT_MAX_RUNS,
  model: null,
  effort: null,
};

export function useRunDials(): { dials: RunDials; set: <K extends keyof RunDials>(key: K, value: RunDials[K]) => void } {
  const [dials, setDials] = useState<RunDials>(INITIAL_DIALS);
  return { dials, set: (key, value) => setDials((d) => ({ ...d, [key]: value })) };
}
