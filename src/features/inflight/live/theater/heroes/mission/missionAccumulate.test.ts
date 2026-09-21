// The Mission hero's memory, as pure state: what a pulse adds, what may animate (one-shot), when a
// session resets, how an edit of a file first read re-enters, and how the phase word's hold behaves.

import { describe, expect, it } from "vitest";
import type { LaneActivity, LanePulse, LoopPulse } from "@/lib/local/runner-types";
import { DEMO_EPOCH, fixtureLane, fixturePulse, fixturePulseAt } from "../../theaterFixture";
import { accumulate, arrivedLive, chipCounts, EMPTY_ACC, stripChips, type MissionAcc } from "./missionAccumulate";
import { landedFor, laneView, showsBand, stageIndex } from "./missionModel";

const iso = (s: number) => new Date(DEMO_EPOCH + s * 1000).toISOString();
const ev = (s: number, kind: LaneActivity["kind"], path: string | null): LaneActivity => ({ at: iso(s), kind, path, tool: null, note: null });

function lane(o: Partial<LanePulse>): LanePulse {
  return fixtureLane({ laneId: "L", startedAt: iso(0), filesRead: [], filesEdited: [], tail: [], ...o });
}
const at = (s: number, ...lanes: LanePulse[]): LoopPulse => fixturePulse({ at: iso(s), lanes });
const fold = (...pulses: LoopPulse[]): MissionAcc => pulses.reduce(accumulate, EMPTY_ACC);

describe("accumulate", () => {
  it("the screen's first pulse is history: nothing it lists may animate in", () => {
    const acc = fold(at(10, lane({ filesRead: ["b.ts", "a.ts"], tail: [ev(9, "read", "b.ts")] })));
    const chips = stripChips(acc.lanes.L, 8);
    expect(chips.map((c) => c.path)).toEqual(["b.ts", "a.ts"]);
    expect(chips.every((c) => !c.live)).toBe(true);
    // A window path with no event carries no time — it must not look fresh.
    expect(acc.lanes.L!.chips["a.ts"]!.lastAt).toBeNull();
  });

  it("a file that first appears on a later pulse arrives live, at the front", () => {
    const acc = fold(at(10, lane({ filesRead: ["a.ts"] })), at(12, lane({ filesRead: ["c.ts", "a.ts"], tail: [ev(11, "read", "c.ts")] })));
    const [front] = stripChips(acc.lanes.L, 8);
    expect(front).toMatchObject({ path: "c.ts", live: true, lastAt: DEMO_EPOCH + 11_000 });
    expect(acc.lanes.L!.chips["a.ts"]!.live).toBe(false);
  });

  it("keeps files that scrolled out of the bounded window", () => {
    const acc = fold(at(10, lane({ filesRead: ["a.ts", "b.ts"] })), at(12, lane({ filesRead: ["c.ts"] })));
    expect(chipCounts(acc.lanes.L)).toEqual({ total: 3, edited: 0 });
  });

  it("an edit of a file first read re-enters at the front, warm", () => {
    const acc = fold(
      at(10, lane({ filesRead: ["a.ts", "b.ts"] })),
      at(12, lane({ filesRead: ["a.ts", "b.ts"], filesEdited: ["b.ts"], tail: [ev(11, "edit", "b.ts")] })),
    );
    expect(stripChips(acc.lanes.L, 8).map((c) => `${c.kind}:${c.path}`)).toEqual(["edit:b.ts", "read:a.ts"]);
    expect(chipCounts(acc.lanes.L)).toEqual({ total: 2, edited: 1 });
  });

  it("the window re-listing a known path is not a new touch; a timed event is", () => {
    const one = fold(at(10, lane({ filesRead: ["a.ts"] })), at(12, lane({ filesRead: ["a.ts"] })));
    expect(one.lanes.L!.chips["a.ts"]!.lastAt).toBeNull();
    const two = accumulate(one, at(14, lane({ filesRead: ["a.ts"], tail: [ev(13, "read", "a.ts")] })));
    expect(two.lanes.L!.chips["a.ts"]!.lastAt).toBe(DEMO_EPOCH + 13_000);
  });

  it("a new session (next cycle) starts from nothing, is complete, and may enter", () => {
    const acc = fold(
      at(10, lane({ filesRead: ["a.ts"] })),
      at(200, lane({ startedAt: iso(190), cycle: 2, filesRead: ["z.ts"], tail: [ev(199, "read", "z.ts")] })),
    );
    expect(chipCounts(acc.lanes.L)).toEqual({ total: 1, edited: 0 });
    expect(acc.lanes.L!.complete).toBe(true);
    expect(acc.lanes.L!.chips["z.ts"]!.live).toBe(true);
    expect(arrivedLive(acc, acc.lanes.L)).toBe(true);
    // Seen mid-session on the first pulse, with files already touched: NOT the whole session.
    expect(fold(at(10, lane({ filesRead: ["a.ts"] }))).lanes.L!.complete).toBe(false);
  });

  it("holds an agent sub-phase before swapping to another; a stage change swaps at once", () => {
    const p = (s: number, phase: LanePulse["phase"]) => at(s, lane({ phase }));
    let acc = fold(p(10, "agent-reading"), p(12, "agent-editing"));
    expect(acc.lanes.L!.shown.phase).toBe("agent-reading");
    acc = accumulate(acc, p(18, "agent-editing"));
    expect(acc.lanes.L!.shown.phase).toBe("agent-editing");
    acc = accumulate(acc, p(19, "verifying"));
    expect(acc.lanes.L!.shown.phase).toBe("verifying");
  });

  it("is idempotent for a pulse already folded", () => {
    const pulse = at(10, lane({ filesRead: ["a.ts"] }));
    const once = fold(pulse);
    expect(accumulate(once, pulse)).toBe(once);
  });
});

describe("the lane model", () => {
  it("maps every phase to a stop on plan → baseline → agent → check → commit → land", () => {
    expect(["planning", "baseline", "agent-quiet", "verifying", "committing", "landing"].map((p) => stageIndex(p as LanePulse["phase"]))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(stageIndex("queued")).toBe(-1);
    expect(stageIndex("done")).toBe(6);
  });

  it("claims Landed only from a landed event inside this lane's session, and holds the ring there", () => {
    const p = fixturePulseAt(DEMO_EPOCH + 172_000);
    const kp = p.lanes.find((l) => l.repo === "acme/kp")!;
    const now = DEMO_EPOCH + 172_000;
    expect(landedFor(kp, p.latest, now)?.kind).toBe("landed");
    const v = laneView(kp, undefined, p.latest, now);
    expect(v).toMatchObject({ tone: "landed", word: "Landed", stage: 6 });
    expect(v.ring!.elapsedMs).toBe(170_000);
    // The previous cycle's landing does not belong to the next session.
    const next = fixturePulseAt(DEMO_EPOCH + 185_000).lanes.find((l) => l.repo === "acme/kp")!;
    expect(landedFor(next, p.latest, DEMO_EPOCH + 185_000)).toBeNull();
  });

  it("a finished lane clears to a row once its Landed moment has passed", () => {
    const done = fixtureLane({ phase: "done", startedAt: iso(0) });
    const landed = [{ at: iso(5), repo: done.repo, kind: "landed" as const, headline: "kp landed" }];
    expect(showsBand(done, landed, DEMO_EPOCH + 20_000)).toBe(true);
    expect(showsBand(done, landed, DEMO_EPOCH + 60_000)).toBe(false);
    expect(showsBand(done, [], DEMO_EPOCH + 20_000)).toBe(false);
  });
});
