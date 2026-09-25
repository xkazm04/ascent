// The wall's camera memory: Mission's per-session accumulator plus a first-seen tile order that never
// reorders — a file's first edit changes its colour, not its place.

import { describe, expect, it } from "vitest";
import type { LaneActivity, LanePulse, LoopPulse } from "@/lib/local/runner-types";
import { DEMO_EPOCH, fixtureLane, fixturePulse, fixturePulseAt } from "../theaterFixture";
import { EMPTY_ONAIR, foldOnAir, mapComplete, mapGroups, type OnAirAcc } from "./onairAccumulate";

const iso = (s: number) => new Date(DEMO_EPOCH + s * 1000).toISOString();
const ev = (s: number, kind: LaneActivity["kind"], path: string | null): LaneActivity => ({ at: iso(s), kind, path, tool: null, note: null });
const lane = (o: Partial<LanePulse>): LanePulse => fixtureLane({ laneId: "L", startedAt: iso(0), filesRead: [], filesEdited: [], tail: [], ...o });
const at = (s: number, ...lanes: LanePulse[]): LoopPulse => fixturePulse({ at: iso(s), lanes });
const fold = (...pulses: LoopPulse[]): OnAirAcc => pulses.reduce(foldOnAir, EMPTY_ONAIR);
const paths = (acc: OnAirAcc) => mapGroups(acc, "L").flatMap((g) => g.files.map((f) => `${f.edited ? "e" : "r"}:${f.path}`));

describe("foldOnAir", () => {
  it("groups files by folder, folders in the order their first file arrived", () => {
    const acc = fold(at(10, lane({ tail: [ev(1, "read", "src/b/x.ts"), ev(2, "read", "src/a/y.ts"), ev(3, "read", "src/b/z.ts")] })));
    expect(mapGroups(acc, "L").map((g) => [g.dir, g.files.map((f) => f.base)])).toEqual([
      ["src/b", ["x.ts", "z.ts"]],
      ["src/a", ["y.ts"]],
    ]);
  });

  it("appends new files and never moves a tile when a read file is later edited", () => {
    const acc = fold(
      at(10, lane({ filesRead: ["b.ts", "a.ts"] })),
      at(12, lane({ filesRead: ["b.ts", "a.ts"], filesEdited: ["a.ts"], tail: [ev(11, "edit", "a.ts"), ev(11, "read", "c.ts")] })),
    );
    // Mission moves the edited file to the FRONT of its strip; the map keeps it where it was.
    expect(paths(acc)).toEqual(["e:a.ts", "r:b.ts", "r:c.ts"]);
  });

  it("keeps files that scrolled out of the bounded window", () => {
    const acc = fold(at(10, lane({ filesRead: ["a.ts", "b.ts"] })), at(12, lane({ filesRead: ["c.ts"] })));
    expect(paths(acc)).toHaveLength(3);
  });

  it("a new session (the next cycle) starts its map from nothing", () => {
    const acc = fold(at(10, lane({ filesRead: ["a.ts"] })), at(200, lane({ startedAt: iso(190), cycle: 2, tail: [ev(199, "read", "z.ts")] })));
    expect(paths(acc)).toEqual(["r:z.ts"]);
    expect(mapComplete(acc, "L")).toBe(true);
  });

  it("the screen's first pulse is history (no tile flashes); later arrivals are live", () => {
    const acc = fold(at(10, lane({ filesRead: ["a.ts"] })), at(12, lane({ filesRead: ["a.ts"], tail: [ev(11, "read", "b.ts")] })));
    const files = mapGroups(acc, "L").flatMap((g) => g.files);
    expect(files.map((f) => [f.path, f.live])).toEqual([
      ["a.ts", false],
      ["b.ts", true],
    ]);
    expect(mapComplete(acc, "L")).toBe(false);
  });

  it("is idempotent for a pulse already folded, and forgets a lane that left", () => {
    const one = fold(at(10, lane({ filesRead: ["a.ts"] })));
    expect(foldOnAir(one, at(10, lane({ filesRead: ["a.ts"] })))).toBe(one);
    const gone = foldOnAir(one, at(12));
    expect(mapGroups(gone, "L")).toEqual([]);
    expect(gone.order.L).toBeUndefined();
  });

  it("accumulates the demo fixture's lanes across its pulses", () => {
    let acc = EMPTY_ONAIR;
    for (let s = 20; s <= 110; s += 2) acc = foldOnAir(acc, fixturePulseAt(DEMO_EPOCH + s * 1000));
    const kp = mapGroups(acc, "lane-kp").flatMap((g) => g.files);
    expect(kp.length).toBeGreaterThan(8); // more than one pulse's window
    expect(kp.some((f) => f.edited)).toBe(true);
  });
});
