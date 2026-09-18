// @vitest-environment jsdom
//
// THE IDLE TICK AND THE CHAIN (2026-09-18). A tab left open used to arm no timer at all while nothing
// was running, so it never learned of a run it did not start — another tab's, the campaign script's,
// a drive's next one. These pin the three guarantees of the replacement:
//   - an idle, foregrounded tab DISCOVERS a run started elsewhere and switches to the live cadence;
//   - the poll is a chain: a slow response delays the next tick, and two reads never overlap;
//   - a hidden tab arms nothing, and an overdue tick fires the moment it comes back.
// Plus the race the idle tick made likelier: a read in flight when THIS tab starts a run must not
// settle that run on its stale `active: null`.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_DISCOVERY_MS, useLoopRun } from "./useLoopRun";
import type { LoopRunRecord } from "./loopTypes";

const run = (o: Partial<LoopRunRecord> = {}): LoopRunRecord =>
  ({ id: "run-9", orgId: "org-1", createdBy: "kaz", phase: "running", repos: ["acme/one"], concurrency: 2, maxCycles: 3, cycle: 1,
    curated: false, startedAt: "2026-09-18T10:00:00Z", endedAt: null, error: null, createdAt: "2026-09-18T10:00:00Z", ...o }) as LoopRunRecord;

const idle = { enabled: true, active: null, runs: [] };
const busy = { enabled: true, active: run(), runs: [] };

/** What the status route answers NOW, how long it takes, and every request with its concurrency. */
let world: { status: unknown; delayMs: number } = { status: idle, delayMs: 0 };
let calls: string[] = [];
let inFlight = 0;
let maxInFlight = 0;

const respond = (url: string): unknown => {
  if (url.startsWith("/api/org/loop?")) return world.status;
  if (url.startsWith("/api/org/loop/run-9")) return { run: run(), lanes: [], outcomes: [], itemOutcomes: [] };
  return { run: run({ phase: "running" }) }; // POST start
};

beforeEach(() => {
  world = { status: idle, delayMs: 0 };
  calls = [];
  inFlight = 0;
  maxInFlight = 0;
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      // Only the poll's READS count toward overlap — an action's POST is the operator's, not the poll's.
      const read = (init?.method ?? "GET") === "GET";
      if (read) inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const body = respond(url);
      if (world.delayMs > 0 && url.startsWith("/api/org/loop?")) await new Promise((r) => setTimeout(r, world.delayMs));
      if (read) inFlight -= 1;
      return { ok: true, json: async () => body } as Response;
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setVisibility("visible");
});

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const statusReads = () => calls.filter((c) => c.startsWith("/api/org/loop?")).length;
const base = { slug: "acme", initialRuns: [], initialEnabled: true, initialActive: null };

describe("useLoopRun — idle discovery", () => {
  it("notices a run started elsewhere, then polls it at the live cadence", async () => {
    const { result } = renderHook(() => useLoopRun(base));
    await advance(10);
    expect(result.current.live).toBe(false);

    world.status = busy; // another tab (or a drive) starts a run
    await advance(IDLE_DISCOVERY_MS);
    expect(result.current.live).toBe(true);
    expect(result.current.activeId).toBe("run-9");
    // Exactly as mount does: the discovering tick also read the run's lanes…
    expect(result.current.detail?.run.id).toBe("run-9");
    // …and the chain is now on the 3-second cadence, not the 20-second one.
    const before = statusReads();
    await advance(3_100);
    expect(statusReads()).toBe(before + 1);
  });
});

describe("useLoopRun — the chain never overlaps", () => {
  it("lets a slow status read delay the next tick instead of starting a second beside it", async () => {
    world = { status: busy, delayMs: 10_000 }; // every status read takes 10 s, over three times the cadence
    renderHook(() => useLoopRun({ ...base, initialActive: run() }));
    await advance(60_000);
    expect(maxInFlight).toBe(1);
    // 10 s per read + 3 s between them ⇒ at most five reads in a minute; an interval would have fired 20.
    expect(statusReads()).toBeGreaterThanOrEqual(4);
    expect(statusReads()).toBeLessThanOrEqual(5);
  });

  it("queues an action's read behind the one in flight rather than beside it", async () => {
    world = { status: busy, delayMs: 5_000 };
    const { result } = renderHook(() => useLoopRun({ ...base, initialActive: run() }));
    await advance(100); // the mount read is now in flight
    await act(async () => void result.current.stop("run-9"));
    await advance(30_000);
    expect(maxInFlight).toBe(1);
  });
});

describe("useLoopRun — a hidden tab costs nothing", () => {
  it("arms no timer while hidden, and reads at once when it is foregrounded again", async () => {
    setVisibility("hidden");
    renderHook(() => useLoopRun({ ...base, initialActive: run() }));
    await advance(90_000);
    expect(calls).toHaveLength(0);

    act(() => setVisibility("visible"));
    await advance(10);
    expect(statusReads()).toBe(1);
  });
});

describe("useLoopRun — a stale read cannot settle a run this tab just started", () => {
  it("discards a read that left before the start landed", async () => {
    world = { status: idle, delayMs: 5_000 };
    const onSettled = vi.fn();
    const { result } = renderHook(() => useLoopRun({ ...base, onSettled }));
    await advance(100); // the mount read (active: null) is in flight
    world = { status: busy, delayMs: 0 };
    await act(async () => void (await result.current.start({ repos: ["acme/one"], concurrency: 1, maxCycles: 1, model: null, effort: null })));
    await advance(6_000); // the stale read lands, then its queued successor reads the truth
    expect(onSettled).not.toHaveBeenCalled();
    expect(result.current.live).toBe(true);
    expect(result.current.activeId).toBe("run-9");
  });
});
