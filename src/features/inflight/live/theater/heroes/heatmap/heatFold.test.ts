// The fold is the heat map's memory: what it keeps across the bounded pulse window, what it can time
// honestly, and what a landing stamps. Pure, so every rule is pinned against hand-built pulses.

import { describe, expect, it } from "vitest";
import type { LaneActivity, PulseEvent } from "@/lib/local/runner-types";
import { DEMO_EPOCH, fixtureLane, fixturePulse, fixturePulseAt } from "../../theaterFixture";
import { foldPulse, laneOfRepo } from "./heatFold";
import { EMPTY_HEAT, FILES_MAX, type HeatAcc } from "./heatTypes";

const T = DEMO_EPOCH;
const iso = (ms: number) => new Date(ms).toISOString();
const ev = (s: number, kind: LaneActivity["kind"], path: string | null): LaneActivity => ({ at: iso(T + s * 1000), kind, path, tool: null, note: null });
const landed = (s: number, kind: PulseEvent["kind"] = "landed"): PulseEvent => ({ at: iso(T + s * 1000), repo: "acme/kp", kind, headline: `kp ${kind} ${s}` });
const lane = (o: Parameters<typeof fixtureLane>[0] = {}) =>
  fixtureLane({ startedAt: iso(T - 60_000), filesRead: [], filesEdited: [], tail: [], ...o });
const pulse = (s: number, l: ReturnType<typeof lane>, latest: PulseEvent[] = []) => fixturePulse({ at: iso(T + s * 1000), lanes: [l], latest });
const file = (acc: HeatAcc, path: string) => acc.repos["acme/kp"]!.files.find((f) => f.path === path);

describe("heat fold — what the map remembers", () => {
  it("times a touch by its tail event; a window path seen first with no event is explored, not timed", () => {
    const a = foldPulse(EMPTY_HEAT, pulse(0, lane({ filesRead: ["src/a/old.ts"], tail: [ev(-5, "edit", "src/b/new.ts")] })), T);
    expect(file(a, "src/b/new.ts")).toMatchObject({ edited: true, editAt: T - 5000, module: "src/b/" });
    expect(file(a, "src/a/old.ts")).toMatchObject({ read: true, readAt: null });
  });

  it("a path first named on a LATER pulse was touched since the last one: timed by that pulse", () => {
    const a = foldPulse(EMPTY_HEAT, pulse(0, lane({ filesRead: ["src/a/old.ts"] })), T);
    const b = foldPulse(a, pulse(2, lane({ filesRead: ["src/a/next.ts", "src/a/old.ts"] })), T + 2000);
    expect(file(b, "src/a/next.ts")?.readAt).toBe(T + 2000);
    expect(file(b, "src/a/old.ts")?.readAt).toBeNull();
  });

  it("keeps files that scrolled out of the window, in first-seen order", () => {
    const a = foldPulse(EMPTY_HEAT, pulse(0, lane({ tail: [ev(0, "read", "x/one.ts")] })), T);
    const b = foldPulse(a, pulse(2, lane({ tail: [ev(2, "read", "y/two.ts")] })), T + 2000);
    expect(b.repos["acme/kp"]!.files.map((f) => f.path)).toEqual(["x/one.ts", "y/two.ts"]);
  });

  it("an event already folded is not folded again; the same pulse twice changes nothing", () => {
    const p = pulse(0, lane({ tail: [ev(0, "read", "x/one.ts")] }));
    const a = foldPulse(EMPTY_HEAT, p, T);
    expect(foldPulse(a, p, T + 1000).repos).toEqual(a.repos);
  });

  it("a new session (laneId or startedAt) is its own: the old one becomes `prev`, the map stays", () => {
    const a = foldPulse(EMPTY_HEAT, pulse(0, lane({ tail: [ev(0, "edit", "x/one.ts")] })), T);
    const b = foldPulse(a, pulse(2, lane({ startedAt: iso(T + 1000) })), T + 2000);
    const r = b.repos["acme/kp"]!;
    expect(r.prev?.editedModules).toEqual(["x/"]);
    expect(r.session).toMatchObject({ editedModules: [], touches: 0 });
    expect(r.files).toHaveLength(1);
  });

  it("does not mutate its input", () => {
    const a = foldPulse(EMPTY_HEAT, pulse(0, lane({ tail: [ev(0, "read", "x/one.ts")] })), T);
    const snapshot = JSON.stringify(a);
    foldPulse(a, pulse(2, lane({ tail: [ev(2, "edit", "x/one.ts")] })), T + 2000);
    expect(JSON.stringify(a)).toBe(snapshot);
  });

  it("past FILES_MAX the coldest read-only files leave; edited files never do", () => {
    let acc = foldPulse(EMPTY_HEAT, pulse(0, lane({ tail: [ev(0, "edit", "e/keep.ts")] })), T);
    for (let i = 0; i < FILES_MAX + 5; i++) acc = foldPulse(acc, pulse(i + 1, lane({ tail: [ev(i + 1, "read", `r/f${i}.ts`)] })), T + i * 1000);
    const files = acc.repos["acme/kp"]!.files;
    expect(files).toHaveLength(FILES_MAX);
    expect(files.some((f) => f.path === "e/keep.ts")).toBe(true);
    expect(files.some((f) => f.path === "r/f0.ts")).toBe(false);
  });

  it("one lane per repo: the working lane wins over its finished predecessor", () => {
    const done = lane({ laneId: "old", phase: "done", startedAt: iso(T + 5000) });
    const live = lane({ laneId: "new", phase: "agent-reading" });
    expect(laneOfRepo([done, live]).map((l) => l.laneId)).toEqual(["new"]);
  });
});

describe("heat fold — stamps", () => {
  const editing = lane({ tail: [ev(0, "edit", "src/scoring/claims.ts"), ev(1, "edit", "docs/SCORING.md")] });

  it("a landing that ARRIVES stamps every module the session edited, celebrated once", () => {
    const a = foldPulse(EMPTY_HEAT, pulse(2, editing), T + 2000);
    const b = foldPulse(a, pulse(4, editing, [landed(3)]), T + 4000);
    const r = b.repos["acme/kp"]!;
    expect(r.stamps.map((s) => [s.module, s.celebrate, s.at])).toEqual([
      ["src/scoring/", true, T + 4000],
      ["docs/", true, T + 4000],
    ]);
    expect(r.landings).toBe(1);
  });

  it("landed + verified-close of one session make ONE stamp per module with both kinds", () => {
    const a = foldPulse(EMPTY_HEAT, pulse(2, editing), T + 2000);
    const b = foldPulse(a, pulse(4, editing, [landed(3, "verified-close"), landed(3)]), T + 4000);
    const r = b.repos["acme/kp"]!;
    expect(r.stamps).toHaveLength(2);
    expect(r.stamps[0]!.kinds).toEqual(["landed", "verified"]);
    expect(r.landings).toBe(1);
  });

  it("a landing already in the FIRST pulse is history: a resting badge if it is this session's, never a celebration", () => {
    const a = foldPulse(EMPTY_HEAT, pulse(4, editing, [landed(3), landed(-3600)]), T + 4000);
    expect(a.repos["acme/kp"]!.stamps.map((s) => s.celebrate)).toEqual([false, false]);
    const old = foldPulse(EMPTY_HEAT, pulse(4, editing, [landed(-3600)]), T + 4000);
    expect(old.repos["acme/kp"]!.stamps).toEqual([]);
  });

  it("a landing seen after the next session began stamps the session that did the work", () => {
    const a = foldPulse(EMPTY_HEAT, pulse(2, editing), T + 2000);
    const b = foldPulse(a, pulse(6, lane({ startedAt: iso(T + 5000) }), [landed(4)]), T + 6000);
    expect(b.repos["acme/kp"]!.stamps.map((s) => s.module)).toEqual(["src/scoring/", "docs/"]);
  });

  it("the demo's scripted landing stamps kp's edited modules when the page is open across it", () => {
    let acc = foldPulse(EMPTY_HEAT, fixturePulseAt(T + 150_000), T + 150_000);
    for (let s = 152; s <= 172; s += 2) acc = foldPulse(acc, fixturePulseAt(T + s * 1000), T + s * 1000);
    const kp = acc.repos["acme/kp"]!;
    expect(kp.stamps.length).toBeGreaterThan(0);
    expect(kp.stamps.every((s) => s.celebrate && s.kinds.includes("landed") && s.kinds.includes("verified"))).toBe(true);
  });
});
