// What a lane monitor says: the lit tile is the tail's newest file, the trail runs from the file
// before it, the tape skips events that say nothing, time used is measured to the (frozen) clock,
// unreported money is "not recorded" (never $0), and "just landed" needs a landing inside the session.

import { describe, expect, it } from "vitest";
import type { LaneActivity, LanePulse, LoopPulse } from "@/lib/local/runner-types";
import { DEMO_EPOCH, fixtureLane, fixturePulse } from "../theaterFixture";
import { EMPTY_ONAIR, foldOnAir } from "./onairAccumulate";
import { laneMonitorView } from "./onairLaneModel";

const iso = (s: number) => new Date(DEMO_EPOCH + s * 1000).toISOString();
const ev = (s: number, kind: LaneActivity["kind"], path: string | null, note: string | null = null): LaneActivity => ({
  at: iso(s),
  kind,
  path,
  tool: kind === "text" || kind === "tool" ? null : "Read",
  note,
});
const lane = (o: Partial<LanePulse> = {}): LanePulse =>
  fixtureLane({ laneId: "L", startedAt: iso(0), deadlineAt: iso(240), filesRead: [], filesEdited: [], tail: [], ...o });
const view = (l: LanePulse, o: Partial<LoopPulse> = {}, clockS = 60, tapeMax = 3) => {
  const p = fixturePulse({ at: iso(clockS), lanes: [l], latest: [], ...o });
  return laneMonitorView(l, p, foldOnAir(EMPTY_ONAIR, p), DEMO_EPOCH + clockS * 1000, tapeMax);
};

describe("laneMonitorView", () => {
  it("lights the tail's newest file and trails from the previous different one while reading/editing", () => {
    const v = view(lane({ phase: "agent-editing", tail: [ev(10, "read", "a.ts"), ev(20, "read", "b.ts"), ev(30, "edit", "b.ts")] }));
    expect(v.lit).toMatchObject({ path: "b.ts", tone: "edit" });
    expect(v.from).toBe("a.ts");
    expect(v.active).toBe(true);
    expect([v.files, v.edited]).toEqual([2, 1]);
  });

  it("no trail once the lane has moved past editing (the lit tile becomes LAST)", () => {
    const v = view(lane({ phase: "verifying", tail: [ev(10, "read", "a.ts"), ev(20, "edit", "b.ts")] }));
    expect(v.active).toBe(false);
    expect(v.from).toBeNull();
    expect(v.stage).toBe("verify");
    expect(v.short).toBe("VERIFYING");
  });

  it("the tape is newest first, bounded, and drops events with neither a path nor words", () => {
    const tail = [ev(1, "read", "a.ts"), ev(2, "text", null, "Tighten the table"), ev(3, "tool", null), ev(4, "text", null, null), ev(5, "edit", "a.ts")];
    const v = view(lane({ phase: "agent-editing", tail }), {}, 60, 2);
    expect(v.tape.map((t) => [t.tool, t.text])).toEqual([
      ["Read", "a.ts"],
      ["note", "Tighten the table"],
    ]);
  });

  it("with no file yet the camera says what the plan stage is doing, with the arm's two models", () => {
    const v = view(lane({ phase: "planning" }));
    expect(v.note).toEqual({ word: "PLANNING", planner: "claude:sonnet", exec: "pi:qwen3.8:27b" });
    expect(v.tapeEmpty).toMatch(/^planning/);
  });

  it("time used is measured to the clock it is given (frozen when stale), against the deadline", () => {
    const v = view(lane({ phase: "agent-reading" }), {}, 90);
    expect([v.used, v.total]).toEqual(["1:30", "4:00"]);
    expect(v.frac).toBeCloseTo(90 / 240);
  });

  it("money that was not reported stays unknown, never $0", () => {
    expect(view(lane({ costMicros: null })).cost).toBeNull();
    expect(view(lane({ costMicros: 620_000_000 })).cost).toBe("$6.20");
  });

  it("tone: green only for a landing inside this session and within 30 s of the pulse", () => {
    const landed = (s: number) => ({ latest: [{ at: iso(s), repo: "acme/kp", kind: "landed" as const, headline: "kp landed" }] });
    expect(view(lane({ phase: "landing" }), landed(50), 60).tone).toBe("green");
    expect(view(lane({ phase: "landing" }), landed(20), 60).tone).toBe("red");
    expect(view(lane({ phase: "landing", startedAt: iso(55) }), landed(50), 60).tone).toBe("red");
    expect(view(lane({ phase: "held" })).tone).toBe("amber");
    expect(view(lane({ phase: "done" })).tone).toBe("grey");
  });

  it("names the org and the repo the way the lower third prints them", () => {
    const v = view(lane({ repo: "acme/kp", cycle: 3 }));
    expect([v.org, v.name, v.cycle]).toEqual(["acme/", "kp", 3]);
  });
});
