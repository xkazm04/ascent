// THE ACTIVITY SINK under fake timers: bounded, throttled (leading + one trailing write per window),
// never overlapping, never throwing, and flushed on demand. The write is injected — no database.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/loop-runs", () => ({ updateLane: vi.fn(async () => null) }));

import { updateLane } from "@/lib/db/loop-runs";
import { createLaneActivitySink, type ActivityWrite } from "@/lib/local/lane-activity";
import { ACTIVITY_TAIL_MAX, ACTIVITY_WRITE_THROTTLE_MS, type AgentStreamEvent, type LaneActivity } from "@/lib/local/runner-types";

const T0 = Date.parse("2026-09-18T10:00:00.000Z");
const read = (path: string): AgentStreamEvent => ({ kind: "read", path, tool: "Read", note: null });
type Call = { activity: LaneActivity[]; heartbeatAt: Date };

function recorder(impl?: () => Promise<unknown>) {
  const calls: Call[] = [];
  const write: ActivityWrite = vi.fn(async (_id, patch) => {
    calls.push(patch);
    return impl ? impl() : null;
  });
  return { calls, write };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("createLaneActivitySink", () => {
  it("writes the first event at once, then coalesces a burst into ONE trailing write per window", async () => {
    const { calls, write } = recorder();
    const sink = createLaneActivitySink("lane-1", { write });
    sink.onEvent(read("a.ts"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.activity.map((e) => e.path)).toEqual(["a.ts"]);

    for (const p of ["b.ts", "c.ts", "d.ts"]) {
      await vi.advanceTimersByTimeAsync(500);
      sink.onEvent(read(p));
    }
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(ACTIVITY_WRITE_THROTTLE_MS);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.activity.map((e) => e.path)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
    // Nothing new, nothing written.
    await vi.advanceTimersByTimeAsync(10 * ACTIVITY_WRITE_THROTTLE_MS);
    expect(calls).toHaveLength(2);
  });

  it("stamps heartbeatAt with the NEWEST EVENT's time, and records each event with an ISO `at`", async () => {
    const { calls, write } = recorder();
    const sink = createLaneActivitySink("lane-1", { write });
    await vi.advanceTimersByTimeAsync(1_234);
    sink.onEvent({ kind: "edit", path: "src/x.ts", tool: "Edit", note: null, turns: 3, costMicros: 10 });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls[0]!.heartbeatAt.getTime()).toBe(T0 + 1_234);
    // The tail keeps the LaneActivity shape only — running totals live on the lane row.
    expect(calls[0]!.activity).toEqual([{ at: new Date(T0 + 1_234).toISOString(), kind: "edit", path: "src/x.ts", tool: "Edit", note: null }]);
  });

  it("keeps only the newest ACTIVITY_TAIL_MAX events", async () => {
    const { calls, write } = recorder();
    const sink = createLaneActivitySink("lane-1", { write });
    for (let i = 0; i < ACTIVITY_TAIL_MAX + 25; i += 1) sink.onEvent(read(`f${i}.ts`));
    await sink.flush();
    const last = calls.at(-1)!.activity;
    expect(last).toHaveLength(ACTIVITY_TAIL_MAX);
    expect(last[0]!.path).toBe("f25.ts");
    expect(last.at(-1)!.path).toBe(`f${ACTIVITY_TAIL_MAX + 24}.ts`);
  });

  it("flush() writes what is pending NOW — the trailing write is guaranteed — and is safe to repeat", async () => {
    const { calls, write } = recorder();
    const sink = createLaneActivitySink("lane-1", { write });
    sink.onEvent(read("a.ts"));
    await vi.advanceTimersByTimeAsync(0);
    sink.onEvent(read("b.ts"));
    await sink.flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.activity.map((e) => e.path)).toEqual(["a.ts", "b.ts"]);
    await sink.flush();
    await sink.flush();
    expect(calls).toHaveLength(2);
    // No timer outlives the flush.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never overlaps two writes — a slow write is followed by the NEWEST tail, never an older one", async () => {
    let release!: () => void;
    const { calls, write } = recorder(() => new Promise<void>((r) => (release = r)));
    const sink = createLaneActivitySink("lane-1", { write });
    sink.onEvent(read("a.ts"));
    await vi.advanceTimersByTimeAsync(0);
    sink.onEvent(read("b.ts"));
    await vi.advanceTimersByTimeAsync(ACTIVITY_WRITE_THROTTLE_MS * 3);
    sink.onEvent(read("c.ts"));
    // The first write is still in flight: nothing else has been sent.
    expect(calls).toHaveLength(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.activity.map((e) => e.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
    release();
    await sink.flush();
  });

  it("drops a failed write and never throws — the next event writes the newer tail anyway", async () => {
    const { calls, write } = recorder(async () => {
      throw new Error("db down");
    });
    const sink = createLaneActivitySink("lane-1", { write });
    expect(() => sink.onEvent(read("a.ts"))).not.toThrow();
    await vi.advanceTimersByTimeAsync(ACTIVITY_WRITE_THROTTLE_MS);
    sink.onEvent(read("b.ts"));
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(calls.at(-1)!.activity.map((e) => e.path)).toEqual(["a.ts", "b.ts"]);
  });

  it("survives a write that throws synchronously", async () => {
    const write: ActivityWrite = vi.fn(() => {
      throw new Error("sync boom");
    });
    const sink = createLaneActivitySink("lane-1", { write });
    expect(() => sink.onEvent(read("a.ts"))).not.toThrow();
    await expect(sink.flush()).resolves.toBeUndefined();
  });

  it("writes through updateLane by default", async () => {
    const sink = createLaneActivitySink("lane-9");
    sink.onEvent(read("a.ts"));
    await sink.flush();
    expect(updateLane).toHaveBeenCalledWith("lane-9", expect.objectContaining({ activity: [expect.objectContaining({ path: "a.ts" })] }));
  });

  it("starts from nothing — a new sink per lane cycle carries no earlier cycle's tail", async () => {
    const one = recorder();
    createLaneActivitySink("lane-1", { write: one.write }).onEvent(read("old.ts"));
    const two = recorder();
    const sink = createLaneActivitySink("lane-2", { write: two.write });
    sink.onEvent(read("new.ts"));
    await sink.flush();
    expect(two.calls.at(-1)!.activity.map((e) => e.path)).toEqual(["new.ts"]);
  });
});
