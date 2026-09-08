// The segment comparison's encodings — above all, that an UNSCANNED side is a void and never a zero.
//
// The sentinel is gone at the source: `summarizeScopedRepos` emits `avgOverall: null` for a scope with
// no scanned repo (2026-09-08), so the fixtures below spell the absence as `null` and this module is
// pinned reading the field it draws rather than inferring the void from `scannedCount`.

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

/** A delta needs BOTH ends — the same rule `buildSegmentComparison` applies in the producer. */
const sub = (x: number | null, y: number | null) => (x === null || y === null ? null : x - y);

const comparison = (a: SegmentSummary, b: SegmentSummary, dims: SegmentComparison["dimDeltas"] = []): SegmentComparison => ({
  a,
  b,
  deltas: { overall: sub(a.avgOverall, b.avgOverall), adoption: sub(a.avgAdoption, b.avgAdoption), rigor: sub(a.avgRigor, b.avgRigor) },
  dimDeltas: dims,
});

/** An unscanned scope, exactly as the producer emits it: no repos scanned, no averages, no posture. */
const unscanned = (name: string): SegmentSummary =>
  summary({ name, scannedCount: 0, avgOverall: null, avgAdoption: null, avgRigor: null, posture: null });

describe("maturity matrix", () => {
  it("keeps a MEASURED zero a score — the discriminator is the value's presence, not its size", () => {
    // The whole point of the null: 0 is a real grade when someone looked, and it must still paint.
    const rows = segmentMatrixRows([summary({ name: "floor", avgOverall: 0, avgAdoption: 0, avgRigor: 0 })]);
    expect(rows[0]!.cells).toEqual([
      { state: "measured", score: 0 },
      { state: "measured", score: 0 },
      { state: "measured", score: 0 },
    ]);
  });

  it("names three axes and scores a scanned segment on each", () => {
    expect([...SEGMENT_AXES]).toEqual(["Overall", "Adopt", "Rigor"]);
    const rows = segmentMatrixRows([summary({ name: "platform" })]);
    expect(rows[0]!.cells).toEqual([
      { state: "measured", score: 60 },
      { state: "measured", score: 55 },
      { state: "measured", score: 65 },
    ]);
  });

  it("HATCHES an unscanned segment instead of painting a zero", () => {
    const rows = segmentMatrixRows([unscanned("new")]);
    expect(rows[0]!.cells.every((c) => c.state === "not-judged")).toBe(true);
    expect(rows[0]!.cells.every((c) => c.score === undefined)).toBe(true);
    expect(rendersValue("not-judged")).toBe(false);
  });

  it("lists only the states present", () => {
    const mixed = segmentMatrixRows([summary({ name: "a" }), unscanned("b")]);
    expect(segmentMatrixStates(mixed)).toEqual(["measured", "not-judged"]);
  });
});

describe("paired rows", () => {
  it("carries both sides and the delta when both are scanned", () => {
    const rows = headlinePairs(comparison(summary({ name: "a" }), summary({ name: "b", avgOverall: 40 })));
    expect(rows[0]).toEqual({ id: "overall", label: "Overall", a: 60, b: 40, delta: 20 });
  });

  it("voids an unscanned side AND withholds the delta rather than comparing against nothing", () => {
    const rows = headlinePairs(comparison(summary({ name: "a" }), unscanned("b")));
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
    const oneEmpty = headlinePairs(comparison(summary({ name: "a" }), unscanned("b")));
    expect(pairedStates(oneEmpty)).toEqual(["measured", "missing"]);
  });
});
