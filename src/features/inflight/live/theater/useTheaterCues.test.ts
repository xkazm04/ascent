// The cue controller on fake timers: a card per due cue, the 20 s cap with coalescing, a tone ONLY when
// sound is on, every card gone after CELEBRATION_MS, and nothing left armed after dispose.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CELEBRATION_MS } from "@/components/org/shared/liveWarRoomShared";
import type { PulseEvent } from "@/lib/local/runner-types";
import { CUE_GAP_MS, type TheaterCue } from "./theaterCues";
import { createCueController } from "./useTheaterCues";

const ev = (kind: PulseEvent["kind"], repo = "acme/kp"): PulseEvent => ({ at: "2026-09-18T12:00:00Z", repo, kind, headline: `${repo} ${kind}` });

let shown: TheaterCue[] = [];
let hidden: string[] = [];
const play = vi.fn();
const make = () => createCueController((c) => shown.push(c), (id) => hidden.push(id), play);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
  shown = [];
  hidden = [];
  play.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("createCueController", () => {
  it("shows a cue for an arrival, silently while sound is off, and clears it after CELEBRATION_MS", () => {
    const ctl = make();
    ctl.push([ev("landed")]);
    vi.advanceTimersByTime(0);
    expect(shown).toHaveLength(1);
    expect(play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CELEBRATION_MS);
    expect(hidden).toEqual([shown[0]!.id]);
  });

  it("plays the cue's own tone only once sound is unlocked", () => {
    const ctl = make();
    ctl.setSound(true);
    ctl.push([ev("plan-pending")]);
    vi.advanceTimersByTime(0);
    expect(play).toHaveBeenCalledWith("attention");
    vi.advanceTimersByTime(CUE_GAP_MS);
    ctl.push([ev("landed")]);
    vi.advanceTimersByTime(0);
    expect(play).toHaveBeenLastCalledWith("celebrate");
  });

  it("caps at one cue per CUE_GAP_MS and coalesces everything that arrived inside the gap", () => {
    const ctl = make();
    ctl.push([ev("landed", "a/1")]);
    vi.advanceTimersByTime(0);
    ctl.push([ev("landed", "a/2")]);
    vi.advanceTimersByTime(5_000);
    ctl.push([ev("landed", "a/3"), ev("direction-done", "a/4")]);
    vi.advanceTimersByTime(CUE_GAP_MS - 5_001);
    expect(shown).toHaveLength(1); // still inside the gap
    vi.advanceTimersByTime(1);
    expect(shown).toHaveLength(2);
    expect(shown[1]).toMatchObject({ kind: "celebrate", headline: "2 landed · 1 direction done" });
  });

  it("ignores rail-only arrivals entirely", () => {
    const ctl = make();
    ctl.push([ev("verified-close"), ev("failed")]);
    vi.advanceTimersByTime(60_000);
    expect(shown).toEqual([]);
  });

  it("dispose leaves nothing armed", () => {
    const ctl = make();
    ctl.push([ev("landed")]);
    ctl.dispose();
    vi.advanceTimersByTime(60_000);
    expect(shown).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
