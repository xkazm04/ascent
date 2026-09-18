// THE PULSE — everything a passive screen needs, from ONE lean read
// (spark theater-upgrade, 2026-09-18; WP4 implements).
//
// Deliberately NOT `getLoopRunDetail`: that read runs the stale sweep, lists 20 runs, prices the org and
// compares scans per lane — right for a detail view, wrong for a 2-second poll. This one reads the
// active run, its lanes' live columns (phase, stage, stageAt, heartbeatAt, deadlineAt, activityJson,
// costMicros, turns), the continuous drive's row, the pending plans' count, and today's landed and
// verified counts, and derives each lane's phase with `deriveLanePhase`.

import type { LoopPulse } from "@/lib/local/runner-types";

/** STUB (WP0): nothing to report. */
export async function getLoopPulse(_orgSlug: string, _now: Date = new Date()): Promise<LoopPulse | null> {
  return null;
}
