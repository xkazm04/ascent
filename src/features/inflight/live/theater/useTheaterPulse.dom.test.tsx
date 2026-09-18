// @vitest-environment jsdom
//
// The theater's transport contract, on fake timers: a NON-overlapping chain (a slow read delays the
// next tick), no polling while hidden and an immediate tick on return, staleness after 10 s without a
// good read, defensive parsing, and arrivals only after the baseline.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEATER_PULSE_MS } from "@/lib/local/runner-types";
import { fixturePulse } from "./theaterFixture";
import { feedStale, useTheaterPulse } from "./useTheaterPulse";

type Reply = { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;
let replies: Reply[] = [];
let calls = 0;
const fetchImpl = vi.fn(async () => {
  calls += 1;
  const r = await (replies.length > 1 ? replies.shift()! : replies[0]!);
  return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body } as Response;
}) as unknown as typeof fetch;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
  calls = 0;
  replies = [{ body: fixturePulse() }];
  setVisibility("visible");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useTheaterPulse", () => {
  it("ticks at once, then every THEATER_PULSE_MS — never a second read while one is in flight", async () => {
    let release!: (v: { body: unknown }) => void;
    replies = [{ body: fixturePulse() }, new Promise((r) => (release = r)), { body: fixturePulse() }];
    const { result } = renderHook(() => useTheaterPulse("/api/org/loop/pulse?org=acme", { fetchImpl }));
    await advance(0);
    expect(calls).toBe(1);
    expect(result.current.loaded).toBe(true);
    await advance(THEATER_PULSE_MS);
    expect(calls).toBe(2); // the slow one is now in flight…
    await advance(THEATER_PULSE_MS * 5);
    expect(calls).toBe(2); // …and nothing started beside it
    await act(async () => release({ body: fixturePulse() }));
    await advance(THEATER_PULSE_MS);
    expect(calls).toBe(3); // the chain resumes only after it settled
  });

  it("does not poll while hidden, and ticks immediately on return", async () => {
    setVisibility("hidden");
    renderHook(() => useTheaterPulse("/p", { fetchImpl }));
    await advance(30_000);
    expect(calls).toBe(0);
    await act(async () => setVisibility("visible"));
    await advance(0);
    expect(calls).toBe(1);
    await act(async () => setVisibility("hidden"));
    await advance(30_000);
    expect(calls).toBe(1);
  });

  it("goes stale after 10 s without a good read, and recovers on the next one", async () => {
    replies = [{ body: fixturePulse() }, { status: 503, body: { error: "down" } }];
    const { result } = renderHook(() => useTheaterPulse("/p", { fetchImpl }));
    await advance(0);
    expect(feedStale(result.current)).toBe(false);
    await advance(9_000);
    expect(feedStale(result.current)).toBe(false);
    await advance(3_000);
    expect(feedStale(result.current)).toBe(true);
    expect(result.current.error).toBe("down");
    expect(result.current.pulse).not.toBeNull(); // kept — the page labels it, it does not discard it
    replies = [{ body: fixturePulse() }];
    await advance(15_000);
    expect(feedStale(result.current)).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("back from a long hidden spell: fresh at once on a good read, honestly stale within a second on a dead server", async () => {
    replies = [{ body: fixturePulse() }];
    const { result } = renderHook(() => useTheaterPulse("/p", { fetchImpl }));
    await advance(0);
    await act(async () => setVisibility("hidden"));
    await advance(60_000);
    expect(feedStale(result.current)).toBe(false); // nothing on screen moved while hidden
    await act(async () => setVisibility("visible"));
    await advance(0);
    expect(feedStale(result.current)).toBe(false); // the return's immediate read landed
    await act(async () => setVisibility("hidden"));
    replies = [{ status: 503, body: { error: "down" } }];
    await advance(60_000);
    await act(async () => setVisibility("visible"));
    await advance(1_000);
    expect(feedStale(result.current)).toBe(true); // a minute-old pulse never passes for live
  });

  it("reads `{ pulse: null }` as a valid 'nothing running' and garbage as a failed read", async () => {
    replies = [{ body: { pulse: null } }];
    const a = renderHook(() => useTheaterPulse("/p", { fetchImpl }));
    await advance(0);
    expect(a.result.current).toMatchObject({ loaded: true, pulse: null, error: null });
    a.unmount();
    replies = [{ body: "<html>oops</html>" }];
    const b = renderHook(() => useTheaterPulse("/p", { fetchImpl }));
    await advance(0);
    expect(b.result.current.loaded).toBe(false);
    expect(b.result.current.error).toMatch(/unreadable/);
  });

  it("hands over arrivals only after the baseline, and records them for the rail's one entrance", async () => {
    const landed = { at: "2026-09-18T12:00:05.000Z", repo: "acme/kp", kind: "landed" as const, headline: "kp landed" };
    const base = fixturePulse();
    replies = [{ body: base }, { body: { ...base, latest: [landed, ...base.latest] } }];
    const onArrivals = vi.fn();
    const { result } = renderHook(() => useTheaterPulse("/p", { fetchImpl, onArrivals }));
    await advance(0);
    expect(onArrivals).not.toHaveBeenCalled(); // the first load is history
    await advance(THEATER_PULSE_MS);
    expect(onArrivals).toHaveBeenCalledTimes(1);
    expect(onArrivals).toHaveBeenCalledWith([landed]);
    expect(result.current.arrivedKeys.size).toBe(1);
    await advance(THEATER_PULSE_MS * 3);
    expect(onArrivals).toHaveBeenCalledTimes(1); // re-delivery is not a second arrival
  });

  it("a null url never fetches (the demo feeds itself)", async () => {
    renderHook(() => useTheaterPulse(null, { fetchImpl }));
    await advance(20_000);
    expect(calls).toBe(0);
  });
});
