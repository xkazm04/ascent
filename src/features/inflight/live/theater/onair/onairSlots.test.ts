// Who is on which monitor: the program is sticky while its lane works and cuts once when it goes back
// to planning; previews never jump; the cut counter keys the wipe.

import { describe, expect, it } from "vitest";
import type { LanePhase, LanePulse } from "@/lib/local/runner-types";
import { DEMO_EPOCH, fixtureLane, fixturePulse, fixturePulseAt } from "../theaterFixture";
import { assignSlots, EMPTY_MEMORY, EMPTY_SLOTS, pickProgram, stepMemory, type OnAirSlots } from "./onairSlots";

const iso = (s: number) => new Date(DEMO_EPOCH + s * 1000).toISOString();
const lane = (id: string, phase: LanePhase, beat = 0): LanePulse =>
  fixtureLane({ laneId: id, repo: `acme/${id}`, phase, heartbeatAt: iso(beat), phaseSince: iso(0), tail: [] });
const run = (...frames: LanePulse[][]): OnAirSlots => frames.reduce(assignSlots, EMPTY_SLOTS);

describe("pickProgram", () => {
  it("prefers the busiest lane that is past its plan", () => {
    expect(pickProgram([lane("a", "planning", 9), lane("b", "agent-reading", 1)], null)?.laneId).toBe("b");
  });
  it("stays on the current lane while it works, even when another is busier", () => {
    expect(pickProgram([lane("a", "agent-editing", 1), lane("b", "agent-reading", 9)], "a")?.laneId).toBe("a");
  });
  it("cuts away when the program lane goes back to planning", () => {
    expect(pickProgram([lane("a", "planning", 9), lane("b", "verifying", 1)], "a")?.laneId).toBe("b");
  });
  it("holds a planning program when nothing else is on camera, and falls back to any lane", () => {
    expect(pickProgram([lane("a", "planning"), lane("b", "queued")], "a")?.laneId).toBe("a");
    expect(pickProgram([lane("a", "done")], null)?.laneId).toBe("a");
    expect(pickProgram([], null)).toBeNull();
  });
});

describe("assignSlots", () => {
  it("fills previews in lane order and keeps every lane in its slot across pulses", () => {
    const one = run([lane("a", "agent-editing", 5), lane("b", "planning"), lane("c", "planning"), lane("d", "planning")]);
    expect(one).toMatchObject({ pgm: "a", pvw: ["b", "c", "d"], cuts: 0 });
    // c leaves: its slot frees, nobody else moves; a new lane e takes the free slot.
    const two = assignSlots(one, [lane("a", "agent-editing"), lane("b", "planning"), lane("d", "planning"), lane("e", "queued")]);
    expect(two.pvw).toEqual(["b", "e", "d"]);
  });

  it("a cut swaps the program into the preview it left, and counts once", () => {
    const one = run([lane("a", "agent-editing"), lane("b", "planning")]);
    const cut = assignSlots(one, [lane("a", "planning"), lane("b", "agent-reading")]);
    expect(cut).toMatchObject({ pgm: "b", pvw: ["a", null, null], cuts: 1 });
    const still = assignSlots(cut, [lane("a", "agent-reading", 9), lane("b", "agent-editing", 1)]);
    expect(still).toMatchObject({ pgm: "b", pvw: ["a", null, null], cuts: 1 });
  });

  it("the first program is not a cut, and losing every lane is not one either", () => {
    expect(run([lane("a", "agent-editing")]).cuts).toBe(0);
    expect(run([lane("a", "agent-editing")], []).cuts).toBe(0);
  });

  it("a lane never changes monitor between pulses over the demo's recorded minutes, except on a cut", () => {
    let mem = EMPTY_MEMORY;
    for (let s = 0; s < 400; s += 2) {
      const prev = mem.slots;
      mem = stepMemory(mem, fixturePulseAt(DEMO_EPOCH + s * 1000));
      if (mem.slots.cuts !== prev.cuts) continue;
      for (const id of prev.pvw) if (id && mem.slots.pvw.includes(id)) expect(mem.slots.pvw.indexOf(id)).toBe(prev.pvw.indexOf(id));
      if (prev.pgm) expect(mem.slots.pgm).toBe(prev.pgm);
    }
    expect(mem.slots.cuts).toBeGreaterThan(0);
  });
});

describe("stepMemory", () => {
  it("folds a pulse once and ignores a repeat or a missing pulse", () => {
    const p = fixturePulse();
    const one = stepMemory(EMPTY_MEMORY, p);
    expect(one.at).toBe(p.at);
    expect(stepMemory(one, p)).toBe(one);
    expect(stepMemory(one, null)).toBe(one);
  });
});
