// The celebration budget and the latest rail's clustering — both pure, both numbers with owners.

import { describe, expect, it } from "vitest";
import type { PulseEvent } from "@/lib/local/runner-types";
import { CUE_GAP_MS, cueClass, cueDelay, emptyCueQueue, enqueueCues, takeCue } from "./theaterCues";
import { clusterLatest } from "./theaterLatest";
import { eventKey } from "./theaterPulseParse";
import { ATTENTION_TONES } from "./theaterSound";
import { CHIME_TONES } from "../liveWarRoomCelebrate";

const ev = (kind: PulseEvent["kind"], repo = "acme/kp", at = "2026-09-18T12:00:00.000Z", headline = `${repo} ${kind}`): PulseEvent => ({ at, repo, kind, headline });

describe("which arrivals earn a moment", () => {
  it("landed / direction-done celebrate; plan-pending / paused call attention; the rest stay on the rail", () => {
    expect(cueClass(ev("landed"))).toBe("celebrate");
    expect(cueClass(ev("direction-done"))).toBe("celebrate");
    expect(cueClass(ev("plan-pending"))).toBe("attention");
    expect(cueClass(ev("paused"))).toBe("attention");
    expect(cueClass(ev("verified-close"))).toBeNull();
    expect(cueClass(ev("failed"))).toBeNull();
    expect(enqueueCues(emptyCueQueue(), [ev("verified-close"), ev("rejected")]).pending).toEqual([]);
  });
});

describe("the cap: at most one cue per CUE_GAP_MS, everything inside the gap coalesces", () => {
  it("fires at once when nothing played recently, then waits out the gap", () => {
    let q = enqueueCues(emptyCueQueue(), [ev("landed")]);
    expect(cueDelay(q, 1_000)).toBe(0);
    const first = takeCue(q, 1_000);
    expect(first.cue).toMatchObject({ kind: "celebrate", headline: "acme/kp landed" });
    q = enqueueCues(first.queue, [ev("landed", "acme/web")]);
    expect(cueDelay(q, 5_000)).toBe(CUE_GAP_MS - 4_000);
    expect(takeCue(q, 5_000).cue).toBeNull();
    expect(takeCue(q, 1_000 + CUE_GAP_MS).cue).not.toBeNull();
  });

  it("a burst coalesces into ONE cue that counts it", () => {
    const q = enqueueCues(emptyCueQueue(), [ev("landed", "a/1"), ev("landed", "a/2"), ev("landed", "a/3"), ev("direction-done", "a/4")]);
    const { cue, queue } = takeCue(q, 0);
    expect(cue).toMatchObject({ kind: "celebrate", headline: "3 landed · 1 direction done" });
    expect(cue!.events).toHaveLength(4);
    expect(queue.pending).toEqual([]);
  });

  it("a person being needed outranks a celebration in the same cue", () => {
    const q = enqueueCues(emptyCueQueue(), [ev("landed"), ev("plan-pending", "acme/web", undefined, "web: a plan waits")]);
    expect(takeCue(q, 0).cue).toMatchObject({ kind: "attention", headline: "web: a plan waits", detail: "Also: acme/kp landed" });
  });

  it("nothing pending → no cue and no delay", () => {
    expect(cueDelay(emptyCueQueue(), 0)).toBeNull();
    expect(takeCue(emptyCueQueue(), 0).cue).toBeNull();
  });
});

describe("the attention tone is derived from the wall's chime", () => {
  it("same pitches and timing, falling instead of rising", () => {
    expect(ATTENTION_TONES.map(([f]) => f)).toEqual([...CHIME_TONES.map(([f]) => f)].reverse());
    expect(ATTENTION_TONES.map(([, at]) => at)).toEqual(CHIME_TONES.map(([, at]) => at));
  });
});

describe("clusterLatest (feed/event-clustering)", () => {
  const t = (s: number) => new Date(Date.UTC(2026, 8, 18, 12, 0, s)).toISOString();

  it("clusters consecutive same-repo same-kind events within two minutes; the newest speaks for the run", () => {
    const events = [ev("landed", "acme/kp", t(100), "kp #3"), ev("landed", "acme/kp", t(40), "kp #2"), ev("landed", "acme/kp", t(0), "kp #1")];
    const [c, ...rest] = clusterLatest(events);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ count: 3, headline: "kp #3", at: t(100), anchorKey: eventKey(events[2]!) });
  });

  it("never clusters across an interleaved event, across a gap, or a failure at all", () => {
    expect(clusterLatest([ev("landed", "a/1", t(10)), ev("landed", "a/2", t(5)), ev("landed", "a/1", t(0))])).toHaveLength(3);
    expect(clusterLatest([ev("landed", "a/1", t(300)), ev("landed", "a/1", t(0))])).toHaveLength(2);
    expect(clusterLatest([ev("failed", "a/1", t(10)), ev("failed", "a/1", t(5))])).toHaveLength(2);
    expect(clusterLatest([ev("rejected", "a/1", t(10)), ev("rejected", "a/1", t(5))])).toHaveLength(2);
  });

  it("a cluster keeps its identity as newer members join at the head (no re-entrance)", () => {
    const older = [ev("landed", "acme/kp", t(40)), ev("landed", "acme/kp", t(0))];
    const grown = [ev("landed", "acme/kp", t(90)), ...older];
    expect(clusterLatest(grown)[0]!.id).toBe(clusterLatest(older)[0]!.id);
    expect(clusterLatest(grown)[0]!.count).toBe(3);
  });
});
