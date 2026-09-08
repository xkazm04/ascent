// The segment comparison's encodings — above all, that an UNSCANNED side is a void and never the
// `avgOverall: 0` sentinel the rollup reduces it to.

import { describe, it, expect } from "vitest";
import { rendersValue } from "@/components/org/viz";
import type { SegmentComparison, SegmentSummary } from "@/lib/db";
import {
  SEGMENT_AXES,
  dimensionPairs,
  headlinePairs,
  pairedStates,
  segmentMatrixRows,
  segmentMatrixStates,
} from "./segmentViz";

const summary = (over: Partial<SegmentSummary> & { name: string }): SegmentSummary =>
  ({
    id: over.name,
    name: over.name,
    repoCount: 3,
    scannedCount: 3,
    avgOverall: 60,
    avgAdoption: 55,
    avgRigor: 65,
    posture: "balanced",
    dimAverages: [],
    ...over,
  }) as SegmentSummary;

const comparison = (a: SegmentSummary, b: SegmentSummary, dims: SegmentComparison["dimDeltas"] = []): SegmentComparison => ({
  a,
  b,
  deltas: { overall: a.avgOverall - b.avgOverall, adoption: a.avgAdoption - b.avgAdoption, rigor: a.avgRigor - b.avgRigor },
  dimDeltas: dims,
});

describe("maturity matrix", () => {
  it("names three axes and scores a scanned segment on each", () => {
    expect([...SEGMENT_AXES]).toEqual(["Overall", "Adopt", "Rigor"]);
    const rows = segmentMatrixRows([summary({ name: "platform" })]);
    expect(rows[0]!.cells).toEqual([
      { state: "measured", score: 60 },
      { state: "measured", score: 55 },
      { state: "measured", score: 65 },
    ]);
  });

  it("HATCHES an unscanned segment instead of painting its sentinel zero", () => {
    const rows = segmentMatrixRows([summary({ name: "new", scannedCount: 0, avgOverall: 0, avgAdoption: 0, avgRigor: 0 })]);
    expect(rows[0]!.cells.every((c) => c.state === "not-judged")).toBe(true);
    expect(rows[0]!.cells.every((c) => c.score === undefined)).toBe(true);
    expect(rendersValue("not-judged")).toBe(false);
  });

  it("lists only the states present", () => {
    const mixed = segmentMatrixRows([summary({ name: "a" }), summary({ name: "b", scannedCount: 0 })]);
    expect(segmentMatrixStates(mixed)).toEqual(["measured", "not-judged"]);
  });
});

describe("paired rows", () => {
  it("carries both sides and the delta when both are scanned", () => {
    const rows = headlinePairs(comparison(summary({ name: "a" }), summary({ name: "b", avgOverall: 40 })));
    expect(rows[0]).toEqual({ id: "overall", label: "Overall", a: 60, b: 40, delta: 20 });
  });

  it("voids an unscanned side AND withholds the delta rather than comparing to a sentinel", () => {
    const rows = headlinePairs(
      comparison(summary({ name: "a" }), summary({ name: "b", scannedCount: 0, avgOverall: 0, avgAdoption: 0, avgRigor: 0 })),
    );
    expect(rows.map((r) => r.b)).toEqual([null, null, null]);
    expect(rows.map((r) => r.delta)).toEqual([null, null, null]);
    expect(rows.map((r) => r.a)).toEqual([60, 55, 65]);
  });

  it("maps dimensions through the caller's short-label function, in the given order", () => {
    const rows = dimensionPairs(
      comparison(summary({ name: "a" }), summary({ name: "b" }), [
        { dimId: "D1", a: 70, b: 50, delta: 20 },
        { dimId: "D2", a: 30, b: 40, delta: -10 },
      ]),
      (id) => `short:${id}`,
    );
    expect(rows.map((r) => [r.label, r.a, r.b, r.delta])).toEqual([
      ["short:D1", 70, 50, 20],
      ["short:D2", 30, 40, -10],
    ]);
  });

  it("reports the states a set of rows contains", () => {
    const both = headlinePairs(comparison(summary({ name: "a" }), summary({ name: "b" })));
    expect(pairedStates(both)).toEqual(["measured"]);
    const oneEmpty = headlinePairs(comparison(summary({ name: "a" }), summary({ name: "b", scannedCount: 0 })));
    expect(pairedStates(oneEmpty)).toEqual(["measured", "missing"]);
  });
});
