// ONLY AN ARCHITECTURE MOVE WAITS — the per-item split, the one-direction rule, and the declared-vs-
// actual comparison the fence check holds a lane to.

import { describe, expect, it } from "vitest";
import { classifyPlan, moveCovered, movesInsideFence, normalizeFence, splitPlan, undeclaredMoves } from "./lane-plan-classify";
import type { ArchitectureMove, LanePlan, ModulePartition } from "./runner-types";

const PART: ModulePartition = { source: "directory", modules: ["src/lib/local/", "src/app/api/", "src/lib/db/", "src/lib/ui/"] };
const cross = (from: string, to: string): ArchitectureMove => ({ kind: "cross-module-move", from, to });
const created = (to: string): ArchitectureMove => ({ kind: "module-created", from: null, to });

function plan(items: [string, ArchitectureMove[]][]): LanePlan {
  return {
    v: 1,
    intent: "intent",
    items: items.map(([id, moves]) => ({ recommendationId: id, approach: `do ${id}`, files: [], moves })),
    modules: ["src/lib/"],
    check: "npm test",
    risks: [],
    notDoing: [],
  };
}

describe("splitPlan — per item", () => {
  it("an item with no moves executes now; a same-module 'move' is no move", () => {
    const s = splitPlan(plan([["a", []], ["b", [cross("src/lib/db/x.ts", "src/lib/db/y/")]]]), PART, [], ["a", "b"]);
    expect(s.items.map((i) => [i.recommendationId, i.cls, i.reason])).toEqual([
      ["a", "minor", "no-moves"],
      ["b", "minor", "no-moves"],
    ]);
    expect(s.direction).toBeNull();
  });

  it("an item with a declared move is parked as major; the rest still execute (the mixed split)", () => {
    const s = splitPlan(plan([["a", []], ["b", [cross("src/lib/db/", "src/lib/local/")]]]), PART, [], ["a", "b"]);
    expect(s.items.map((i) => i.cls)).toEqual(["minor", "major"]);
    expect(s.items[1]).toMatchObject({ reason: "declared-moves", moves: [cross("src/lib/db/", "src/lib/local/")] });
  });

  it("moves wholly inside an active direction's fence run under that direction", () => {
    const d = { id: "dir-1", fence: ["src/lib/"] };
    const s = splitPlan(plan([["a", [created("src/lib/fresh/")]], ["b", [cross("src/lib/db/", "src/app/api/")]]]), PART, [d], ["a", "b"]);
    expect(s.items.map((i) => [i.cls, i.directionId])).toEqual([
      ["minor-under-direction", "dir-1"],
      ["major", null],
    ]);
    expect(s.direction).toEqual(d);
  });

  it("runs under ONE direction: the one covering most items wins, the other's item is parked", () => {
    const d1 = { id: "d1", fence: ["src/app/"] };
    const d2 = { id: "d2", fence: ["src/lib/"] };
    const s = splitPlan(
      plan([["a", [created("src/app/new/")]], ["b", [created("src/lib/x/")]], ["c", [cross("src/lib/db/", "src/lib/ui/")]]]),
      PART,
      [d1, d2],
      ["a", "b", "c"],
    );
    expect(s.direction?.id).toBe("d2");
    expect(s.items.map((i) => i.cls)).toEqual(["major", "minor-under-direction", "minor-under-direction"]);
  });

  it("an unreadable plan parks every item; an item the plan never mentioned declared no move", () => {
    expect(splitPlan(null, PART, [], ["a", "b"]).items.map((i) => [i.cls, i.reason])).toEqual([
      ["major", "unreadable"],
      ["major", "unreadable"],
    ]);
    const s = splitPlan(plan([["a", []]]), PART, [], ["a", "ghost"]);
    expect(s.items[1]).toMatchObject({ recommendationId: "ghost", cls: "minor", entry: null });
  });
});

describe("classifyPlan — the whole plan is its worst item", () => {
  it.each<[string, LanePlan | null, string[][], { cls: string; reason: string }]>([
    ["unreadable", null, [], { cls: "major", reason: "unreadable" }],
    ["no moves", plan([["a", []]]), [], { cls: "minor", reason: "no-moves" }],
    ["a declared move", plan([["a", [created("src/lib/n/")]]]), [], { cls: "major", reason: "declared-moves" }],
    ["inside a fence", plan([["a", [created("src/lib/n/")]]]), [["src/lib/"]], { cls: "minor-under-direction", reason: "inside-direction-fence" }],
    ["a root fence grants nothing", plan([["a", [created("src/lib/n/")]]]), [["/", ""]], { cls: "major", reason: "declared-moves" }],
  ])("%s", (_n, p, fences, expected) => {
    expect(classifyPlan(p, PART, fences)).toEqual(expected);
  });
});

describe("the fence check's comparison", () => {
  it("normalizes fences and never lets the root through", () => {
    expect(normalizeFence(["src\\lib", "./src/app/", "/", "", "a/../b"])).toEqual(["src/lib/", "src/app/"]);
    expect(movesInsideFence([created("src/lib/n/")], [])).toBe(false);
  });

  it("covers a move declared with the same kind and modules (either side may name a file or a broader prefix)", () => {
    const actual = cross("src/lib/db/", "src/lib/local/");
    expect(moveCovered(actual, [cross("src/lib/db/a.ts", "src/lib/local/")], PART)).toBe(true);
    expect(moveCovered(actual, [cross("src/lib/local/", "src/lib/db/")], PART)).toBe(false);
    expect(moveCovered(actual, [created("src/lib/local/")], PART)).toBe(false);
  });

  it("a declared split covers its creations and a wildcard end; a declared merge covers the source's removal", () => {
    const split: ArchitectureMove = { kind: "module-split", from: "src/lib/big/", to: null };
    expect(moveCovered(created("src/lib/alpha/"), [{ kind: "module-split", from: "src/lib/big/", to: "src/lib/alpha/" }], PART)).toBe(true);
    expect(moveCovered({ kind: "module-split", from: "src/lib/big/", to: "src/lib/beta/" }, [split], PART)).toBe(true);
    expect(moveCovered({ kind: "module-removed", from: "src/lib/db/", to: null }, [{ kind: "module-merged", from: "src/lib/db/", to: "src/lib/m/" }], PART)).toBe(true);
  });

  it("an actual move neither declared nor fenced is undeclared", () => {
    const actual = [cross("src/lib/db/", "src/lib/local/"), created("src/app/new/")];
    expect(undeclaredMoves(actual, [cross("src/lib/db/", "src/lib/local/")], null, PART)).toEqual([created("src/app/new/")]);
    expect(undeclaredMoves(actual, [], ["src/"], PART)).toEqual([]);
    expect(undeclaredMoves(actual, [], ["src/lib/"], PART)).toEqual([created("src/app/new/")]);
  });
});
