// A RUNNING LANE'S ACTIVITY TAIL — what the passive screen shows instead of "agent working" for 25
// minutes (spark theater-upgrade, 2026-09-18; WP4).
//
// The sink receives every `AgentStreamEvent` synchronously from the runner, keeps a bounded tail
// (`ACTIVITY_TAIL_MAX`) and writes it to `LoopRunLane.activityJson` at most every
// `ACTIVITY_WRITE_THROTTLE_MS`, stamping `heartbeatAt` with each write. `onEvent` NEVER throws and never
// awaits: a failed write is dropped, the session is never slowed by its own telemetry.
//
// THE THROTTLE, precisely: the first event writes at once (a lane that just woke up shows it within one
// pulse); events inside the window after a write coalesce into ONE trailing write at the window's end;
// writes never overlap (a write that is still in flight when the window ends is followed by the next
// one, carrying the newest tail — never an older snapshot landing after a newer one). `flush()` writes
// whatever is pending NOW, and is what guarantees the trailing write when the session ends.
//
// `heartbeatAt` is the NEWEST EVENT's time, not the write's: it is a claim about when the agent was last
// heard from, and the throttle's lag is not the agent's (`fleet-orchestration/lifecycle-signals`: keep
// source time apart from observation time).
//
// ONE SINK PER LANE CYCLE, seeded from nothing. A cycle's lane row is a new row, and the planning and
// execution sessions of one cycle share this tail — which is what lets the phase tell a baseline check
// from a result check (`lane-phase.ts`).

import { updateLane } from "@/lib/db/loop-runs";
import {
  ACTIVITY_TAIL_MAX,
  ACTIVITY_WRITE_THROTTLE_MS,
  type AgentStreamEvent,
  type LaneActivity,
} from "@/lib/local/runner-types";

export interface LaneActivitySink {
  onEvent(e: AgentStreamEvent): void;
  /** Write whatever is buffered now. Safe to call more than once. */
  flush(): Promise<void>;
}

/** The write the sink performs. `updateLane` in production; a test hands its own. */
export type ActivityWrite = (laneId: string, patch: { activity: LaneActivity[]; heartbeatAt: Date }) => Promise<unknown>;

export interface LaneActivitySinkOptions {
  write?: ActivityWrite;
  throttleMs?: number;
}

/** How many rounds `flush` will chase events that keep arriving while it writes. Bounded: a stream
 *  that never stops talking must not turn a flush into a loop. */
const FLUSH_ROUNDS = 4;

export function createLaneActivitySink(laneId: string, opts: LaneActivitySinkOptions = {}): LaneActivitySink {
  const write: ActivityWrite = opts.write ?? ((id, patch) => updateLane(id, patch));
  const throttle = opts.throttleMs ?? ACTIVITY_WRITE_THROTTLE_MS;
  let tail: LaneActivity[] = [];
  let dirty = false;
  let lastWriteAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;

  const disarm = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  /** Start ONE write of the current tail. Never rejects. */
  const send = (): Promise<void> => {
    if (inflight) return inflight;
    if (!dirty) return Promise.resolve();
    dirty = false;
    lastWriteAt = Date.now();
    const activity = tail.slice();
    const newest = activity[activity.length - 1];
    const heartbeatAt = newest ? new Date(newest.at) : new Date();
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(write(laneId, { activity, heartbeatAt }));
    } catch {
      pending = Promise.resolve();
    }
    // A failed write is DROPPED — the next event (or the flush) writes the newer tail anyway.
    const done = pending.then(
      () => undefined,
      () => undefined,
    );
    inflight = done.finally(() => {
      inflight = null;
      if (dirty) schedule();
    });
    return inflight;
  };

  function schedule(): void {
    // Armed already, or a write is in flight — its `finally` reschedules with the newest tail.
    if (timer || inflight) return;
    const wait = Math.max(0, lastWriteAt + throttle - Date.now());
    if (wait === 0) {
      void send();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void send();
    }, wait);
    (timer as { unref?: () => void }).unref?.();
  }

  return {
    onEvent(e: AgentStreamEvent): void {
      try {
        tail.push({ at: new Date().toISOString(), kind: e.kind, path: e.path ?? null, tool: e.tool ?? null, note: e.note ?? null });
        if (tail.length > ACTIVITY_TAIL_MAX) tail = tail.slice(tail.length - ACTIVITY_TAIL_MAX);
        dirty = true;
        schedule();
      } catch {
        // Never the session's problem.
      }
    },
    async flush(): Promise<void> {
      try {
        for (let round = 0; round < FLUSH_ROUNDS; round += 1) {
          disarm();
          if (inflight) {
            await inflight;
            continue;
          }
          if (!dirty) return;
          await send();
        }
      } catch {
        // `send` never rejects; this is the belt.
      } finally {
        // Nothing is left armed behind a flush: a lane that ends does not leave a timer outliving it.
        if (!dirty) disarm();
      }
    },
  };
}
