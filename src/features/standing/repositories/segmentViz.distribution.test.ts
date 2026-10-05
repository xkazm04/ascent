// The distribution model: a segment comparison read as two POPULATIONS instead of two dots.
//
// Split out of segmentViz.test.ts (the 200-LOC features cap, AGENTS.md); that file keeps the paired-row
// and matrix encodings. What is pinned here is the pair of rules the drawing must not lose:
//   a mean and an item are never the same thing (`peer-benchmarking` / population-vs-scalar-ranking), so
//     every side carries BOTH its items and its producer mean, and its mean is passed through rather
//     than recomputed — the mark and the number cannot drift apart;
//   a figure carries its n (`basis-disclosure`), so n=0 and n=1 get their own words rather than a bare
//     average that reads like a segment verdict;
//   and the house rule under both: an unscored dimension is ABSENT, never a 0 in the population.

import { describe, expect, it } from "vitest";
import type { SegmentComparison, SegmentSummary } from "@/lib/db";
import { capItems, distributionRows, laggards, trailingSide } from "./segmentViz";

const pt = (fullName: string, overall: number, dims: Record<string, number>) => ({
  fullName,
  overall,
  dims: Object.entries(dims).map(([dimId, score]) => ({ dimId, score })),
});

const side = (name: string, points: ReturnType<typeof pt>[], over?: Partial<SegmentSummary>): SegmentSummary =>
  ({
    id: name,
    name,
    repoCount: points.length,
    scannedCount: points.length,
    avgOverall: points.length === 0 ? null : Math.round(points.reduce((s, p) => s + p.overall, 0) / points.length),
    avgAdoption: 55,
    avgRigor: 65,
    posture: points.length === 0 ? null : "balanced",
    dimAverages: [],
    points,
    ...over,
  }) as SegmentSummary;

const cmp = (a: SegmentSummary, b: SegmentSummary, dimDeltas: SegmentComparison["dimDeltas"] = []): SegmentComparison =>
  ({
    a,
    b,
    deltas: {
      overall: a.avgOverall == null || b.avgOverall == null ? null : a.avgOverall - b.avgOverall,
      adoption: null,
      rigor: null,
    },
    dimDeltas,
  }) as SegmentComparison;

// The card's fixture: A = 3 scanned repos (40/60/80), B = 2 (70/90). d5 means 40 vs 72.
const A = side("Platform", [pt("acme/a-one", 40, { d5: 30 }), pt("acme/a-two", 60, { d5: 50 }), pt("acme/a-three", 80, {})]);
const B = side("Legacy", [pt("acme/b-one", 70, { d5: 64 }), pt("acme/b-two", 90, { d5: 80 })]);
const D5 = [{ dimId: "d5", a: 40, b: 72, delta: -32 }];

describe("distributionRows", () => {
  it("puts the overall row first and one row per dimension after it, items and mean on every side", () => {
    const rows = distributionRows(cmp(A, B, D5), (d) => d.toUpperCase());
    expect(rows.map((r) => r.id)).toEqual(["overall", "d5"]);
    const overall = rows[0]!;
    expect(overall.a.items.map((i) => i.value)).toEqual([40, 60, 80]);
    expect(overall.b.items.map((i) => i.value)).toEqual([70, 90]);
    // The mean is the PRODUCER's, not a recomputation: the mark and the printed number are one number.
    expect(overall.a.mean).toBe(A.avgOverall);
    expect(overall.b.mean).toBe(B.avgOverall);
    expect(overall.a.n).toBe(3);
    expect(overall.delta).toBe(-20);
    expect(rows[1]!.label).toBe("D5");
  });

  it("states the basis each mean rests on, and says so instead of 'mean' when n is 1", () => {
    const rows = distributionRows(cmp(A, B, D5), (d) => d);
    expect(rows[0]!.a.basis).toBe("mean of 3 scanned repos");
    expect(rows[0]!.b.basis).toBe("mean of 2 scanned repos");
    const solo = distributionRows(cmp(side("Solo", [pt("acme/only", 60, {})]), B), (d) => d)[0]!;
    // A one-repo side draws its item mark AND refuses the word "mean" for itself.
    expect(solo.a.items).toHaveLength(1);
    expect(solo.a.n).toBe(1);
    expect(solo.a.basis).toBe("one scanned repo, not a segment mean");
    expect(solo.a.basis).not.toMatch(/^mean of/);
  });

  it("a side with nothing scanned has no items, no mean and the absence in words", () => {
    const empty = side("New", [], { avgOverall: null, posture: null });
    const row = distributionRows(cmp(empty, B), (d) => d)[0]!;
    expect(row.a.items).toEqual([]);
    expect(row.a.n).toBe(0);
    expect(row.a.mean).toBeNull();
    expect(row.a.basis).toBe("no scanned repository");
    // And no delta against it: a difference from a missing number is comparison theatre.
    expect(row.delta).toBeNull();
  });

  it("a repo the latest scan did not grade on a dimension is UNSCORED, never an item at 0", () => {
    const row = distributionRows(cmp(A, B, D5), (d) => d)[1]!;
    expect(row.a.items.map((i) => i.fullName)).toEqual(["acme/a-one", "acme/a-two"]);
    expect(row.a.items.map((i) => i.value)).not.toContain(0);
    expect(row.a.unscored).toEqual(["acme/a-three"]);
    expect(row.a.n).toBe(2); // the n is the MEASURED count, not the side's repo count
    expect(row.a.basis).toBe("mean of 2 scored repos");
    // A dimension nobody on this side was scored on says that, rather than reading as a zero mean.
    const none = distributionRows(cmp(side("Bare", [pt("acme/bare", 50, {})]), B, D5), (d) => d)[1]!;
    expect(none.a.items).toEqual([]);
    expect(none.a.basis).toBe("not scored on this dimension");
  });

  it("keeps a MEASURED zero in the population — 0 is a grade when someone looked", () => {
    const floor = side("Floor", [pt("acme/floor", 0, { d5: 0 })], { avgOverall: 0, posture: "dormant" });
    const rows = distributionRows(cmp(floor, B, D5), (d) => d);
    expect(rows[0]!.a.items).toEqual([{ fullName: "acme/floor", value: 0 }]);
    expect(rows[1]!.a.items).toEqual([{ fullName: "acme/floor", value: 0 }]);
    expect(rows[1]!.a.unscored).toEqual([]);
  });
});

describe("laggards / trailingSide / capItems", () => {
  it("ranks a side worst-first on the row's metric, with a stable tie-break", () => {
    const row = distributionRows(cmp(A, B, D5), (d) => d)[1]!;
    expect(laggards(row.a).map((i) => i.fullName)).toEqual(["acme/a-one", "acme/a-two"]);
    expect(laggards(row.a, 1)).toEqual([{ fullName: "acme/a-one", value: 30 }]);
    const tied = distributionRows(cmp(side("T", [pt("z/z", 50, {}), pt("a/a", 50, {})]), B), (d) => d)[0]!;
    expect(laggards(tied.a).map((i) => i.fullName)).toEqual(["a/a", "z/z"]);
  });

  it("names the trailing side as the LOWER mean — the population whose repos drag the gap", () => {
    const rows = distributionRows(cmp(A, B, D5), (d) => d);
    expect(trailingSide(rows[1]!)!.name).toBe("Platform"); // d5: 40 vs 72
    expect(trailingSide(rows[0]!)!.name).toBe("Platform"); // overall: 60 vs 80
    // Reversed, the other side trails — the choice is the data's, not the argument order's.
    expect(trailingSide(distributionRows(cmp(B, A, []), (d) => d)[0]!)!.name).toBe("Platform");
  });

  it("with only one side measured there is no 'trailing': the measured side is the one with repos", () => {
    const empty = side("New", [], { avgOverall: null, posture: null });
    expect(trailingSide(distributionRows(cmp(empty, B), (d) => d)[0]!)!.name).toBe("Legacy");
    const both = distributionRows(cmp(empty, side("Also", [], { avgOverall: null, posture: null })), (d) => d)[0]!;
    expect(trailingSide(both)).toBeNull();
  });

  it("bounds what a strip plots and COUNTS the tail rather than smearing it", () => {
    const many = side(
      "Wide",
      Array.from({ length: 50 }, (_, i) => pt(`acme/r${String(i).padStart(2, "0")}`, i + 10, {})),
    );
    const row = distributionRows(cmp(many, B), (d) => d)[0]!;
    const capped = capItems(row.a, 36);
    expect(capped.shown).toHaveLength(36);
    expect(capped.hidden).toBe(14);
    // Worst-first, so the marks kept are the ones a reader came for.
    expect(capped.shown[0]!.fullName).toBe("acme/r00");
    expect(capItems(row.b, 36)).toEqual({ shown: laggards(row.b), hidden: 0 });
  });
});
