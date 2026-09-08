// The void-vs-zero guards for the Tech Stacks tab, pinned without a DOM.
//
// Every assertion here exists because the tab used to answer an ABSENCE with a NUMBER: an unscanned
// stack scored 0, and a dimension a stack carries no average for was plotted at the centre. A test
// that only checked the happy path would have passed on both.

import { describe, it, expect } from "vitest";

import { dimValues, orderStacks, stackSpread, stackState } from "./stackMeasure";
import { radarShape } from "./stackViz";
import type { SegmentSummary } from "@/lib/db";

const stack = (over: Partial<SegmentSummary>): SegmentSummary => ({
  id: "fe",
  name: "Frontend",
  repoCount: 4,
  scannedCount: 4,
  avgOverall: 60,
  avgAdoption: 55,
  avgRigor: 65,
  posture: "p",
  dimAverages: [{ dimId: "D1", avg: 60 }],
  ...over,
});

describe("stackState", () => {
  it("calls a stack with no scanned repo not-judged, not a zero-scoring stack", () => {
    expect(stackState(stack({ scannedCount: 0, avgOverall: 0 }))).toBe("not-judged");
    expect(stackState(stack({ scannedCount: 1 }))).toBe("measured");
  });

  it("keeps a genuinely-zero measured stack measured", () => {
    // 0 is a real score when someone looked. The discriminator is scannedCount, never the value.
    expect(stackState(stack({ scannedCount: 3, avgOverall: 0 }))).toBe("measured");
  });
});

describe("dimValues", () => {
  it("returns null — never 0 — for a dimension the stack carries no average for", () => {
    const v = dimValues(stack({ dimAverages: [{ dimId: "D1", avg: 71 }] }), ["D1", "D2", "D3"]);
    expect(v).toEqual([71, null, null]);
  });

  it("keeps a measured zero distinguishable from an absent average", () => {
    const v = dimValues(stack({ dimAverages: [{ dimId: "D2", avg: 0 }] }), ["D1", "D2"]);
    expect(v).toEqual([null, 0]);
  });
});

describe("stackSpread", () => {
  it("summarises the measured stacks and counts the rest out", () => {
    const s = stackSpread([
      stack({ id: "a", avgOverall: 20 }),
      stack({ id: "b", avgOverall: 40 }),
      stack({ id: "c", avgOverall: 60 }),
      stack({ id: "d", avgOverall: 80 }),
      stack({ id: "z", scannedCount: 0, avgOverall: 0 }),
    ]);
    expect(s).not.toBeNull();
    expect(s!.min).toBe(20);
    expect(s!.max).toBe(80);
    expect(s!.median).toBe(50);
    expect(s!.n).toBe(4);
    // The unscanned stack's sentinel 0 must NOT drag the minimum down to 0.
    expect(s!.unmeasured).toBe(1);
  });

  it("refuses to draw a distribution from fewer than two measured stacks", () => {
    expect(stackSpread([stack({}), stack({ id: "z", scannedCount: 0, avgOverall: 0 })])).toBeNull();
    expect(stackSpread([])).toBeNull();
  });
});

describe("orderStacks", () => {
  it("ranks measured stacks by score and parks the unmeasured ones after them, by name", () => {
    const out = orderStacks([
      stack({ id: "z", name: "Zeta", scannedCount: 0, avgOverall: 0 }),
      stack({ id: "a", name: "Alpha", avgOverall: 40 }),
      stack({ id: "m", name: "Mid", scannedCount: 0, avgOverall: 0 }),
      stack({ id: "b", name: "Beta", avgOverall: 90 }),
    ]);
    expect(out.map((s) => s.name)).toEqual(["Beta", "Alpha", "Mid", "Zeta"]);
  });
});

describe("radarShape", () => {
  const R = 100;

  it("closes a complete profile into one fillable polygon", () => {
    const s = radarShape(0, 0, R, [1, 1, 1, 1]);
    expect(s.paths).toHaveLength(1);
    expect(s.paths[0]!.endsWith(" Z")).toBe(true);
    expect(s.complete).toBe(true);
    expect(s.voidAxes).toEqual([]);
  });

  it("breaks the ring at a void axis and refuses to fill the remainder", () => {
    const s = radarShape(0, 0, R, [0.9, null, 0.8, 0.7]);
    expect(s.complete).toBe(false);
    expect(s.voidAxes).toEqual([1]);
    // One open run (axes 2,3,0 in traversal order) — no "Z", so nothing encloses the missing axis.
    expect(s.paths).toHaveLength(1);
    expect(s.paths[0]!.includes("Z")).toBe(false);
    expect(s.paths[0]!.startsWith("M")).toBe(true);
  });

  it("never plots a void at the centre", () => {
    // The old `?? 0` produced a vertex at (cx, cy). Nothing in the geometry may sit there.
    // Centre at (500, 500) so the coordinate is unmistakable in the path string: with radius 100
    // every real vertex lands in 400..600, and only a void-plotted-as-zero could sit on the centre.
    const s = radarShape(500, 500, R, [1, null, 1, 1]);
    expect(s.paths.join(" ")).not.toBe("");
    expect(s.paths.join(" ")).not.toContain("500.0 500.0");
  });

  it("emits two runs when the voids split the ring in two", () => {
    const s = radarShape(0, 0, R, [1, 1, null, 1, 1, null]);
    expect(s.paths).toHaveLength(2);
    expect(s.voidAxes).toEqual([2, 5]);
  });

  it("drops a lone measured axis stranded between voids — its dot is the whole mark", () => {
    const s = radarShape(0, 0, R, [null, 0.5, null, 0.5]);
    expect(s.paths).toEqual([]);
    expect(s.voidAxes).toEqual([0, 2]);
  });

  it("draws nothing at all for a stack with no measurement anywhere", () => {
    const s = radarShape(0, 0, R, [null, null, null]);
    expect(s.paths).toEqual([]);
    expect(s.complete).toBe(false);
  });
});
