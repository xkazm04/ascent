// A RUNNING LANE'S ACTIVITY TAIL — what the passive screen shows instead of "agent working" for 25
// minutes (spark theater-upgrade, 2026-09-18; WP4 implements).
//
// The sink receives every `AgentStreamEvent` synchronously from the runner, keeps a bounded tail
// (`ACTIVITY_TAIL_MAX`) and writes it to `LoopRunLane.activityJson` at most every
// `ACTIVITY_WRITE_THROTTLE_MS`, stamping `heartbeatAt` with each write. `onEvent` NEVER throws and never
// awaits: a failed write is dropped, the session is never slowed by its own telemetry.

import type { AgentStreamEvent } from "@/lib/local/runner-types";

export interface LaneActivitySink {
  onEvent(e: AgentStreamEvent): void;
  /** Write whatever is buffered now. Safe to call more than once. */
  flush(): Promise<void>;
}

/** STUB (WP0): a sink that records nothing. */
export function createLaneActivitySink(_laneId: string): LaneActivitySink {
  return {
    onEvent() {},
    async flush() {},
  };
}
