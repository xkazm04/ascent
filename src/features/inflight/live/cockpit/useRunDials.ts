"use client";

// The dials the inspector hands the engine, as one piece of state.
//
// They were six `useState` calls in CockpitInspector, which was fine at four and stopped being fine
// when the agent's model and effort joined them: the component is an ORCHESTRATOR (selection →
// proposal → CTA) and every dial it stores itself is a line of state management standing between a
// reader and that flow. One object, one setter, one prop pair — and the run and the drive read the
// same values, which is the property that matters: they are the same experiment armed two ways.

import { useState } from "react";
import { LOOP_DEFAULT_CONCURRENCY } from "@/lib/db/loop-runs-types";
import type { LoopDelivery } from "@/lib/local/delivery-options";
import {
  AGENT_TIMEOUT_DEFAULT_MS,
  BATCH_SIZE_DEFAULT,
  VERIFY_TIMEOUT_DEFAULT_MS,
  type VerifyMode,
} from "@/lib/local/run-limits";
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
  /** WHAT HAPPENS TO EACH LANE'S BRANCH — `branch` (leave it), `land` (fast-forward it into the
   *  branch the paired checkout is on) or `pr`. Remembered exactly like the others: it is a property
   *  of how the work is DELIVERED, so the run and the drive must arm on the same value. */
  delivery: LoopDelivery;
  /** Items one lane works per cycle. The dial that decides whether a change CAN be structural: a
   *  batch of one cannot see two duplicates at once. */
  batchSize: number;
  /** The agent's per-session ceiling, in MINUTES here and milliseconds on the wire — the operator
   *  thinks in minutes and the server's band is in ms. */
  sessionMinutes: number;
  /** The A/B degradation guard. `on` is the default posture; `off` is an explicit refusal to run
   *  repo-authored verification commands. */
  verifyMode: VerifyMode;
  /** Budget for ONE run of the repository's own check, in MINUTES. */
  verifyMinutes: number;
}

const DEFAULT_CYCLES = 3;

export const INITIAL_DIALS: RunDials = {
  dimFocus: null,
  concurrency: LOOP_DEFAULT_CONCURRENCY,
  cycles: DEFAULT_CYCLES,
  maxRuns: DRIVE_DEFAULT_MAX_RUNS,
  model: null,
  effort: null,
  // `branch` is the default because it is what every run before delivery existed did, and because it
  // is the only mode that writes nothing outside the loop's own branches.
  delivery: "branch",
  // Every one of these is the value the loop already used before it was a dial, so an operator who
  // touches none of them arms exactly the run they would have armed yesterday.
  batchSize: BATCH_SIZE_DEFAULT,
  sessionMinutes: AGENT_TIMEOUT_DEFAULT_MS / 60_000,
  verifyMode: "on",
  verifyMinutes: VERIFY_TIMEOUT_DEFAULT_MS / 60_000,
};

export function useRunDials(): { dials: RunDials; set: <K extends keyof RunDials>(key: K, value: RunDials[K]) => void } {
  const [dials, setDials] = useState<RunDials>(INITIAL_DIALS);
  return { dials, set: (key, value) => setDials((d) => ({ ...d, [key]: value })) };
}
