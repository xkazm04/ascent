import { describe, expect, it } from "vitest";
import {
  AGGREGATE_HEX,
  MICRO_POINTS,
  waterfallHeadroom,
  waterfallSegments,
  type WaterfallContribution,
} from "@/components/report/scoreWaterfallSegments";

// G5-13. The waterfall's claim is an identity: segment width === contribution points, and the tail is
// the honest remainder to 100. The old fixed `minWidth: 0.375rem` per non-zero segment broke it — with
// 9 dimensions the summed floors could exceed the track, distorting every visible proportion and
// collapsing the `flex-1` headroom tail to zero on exactly the low-scoring repos where "how far from
// 100 am I" is the whole point. These pin the replacement: no floor, micro-contributions aggregated
// at their TRUE summed width, and Σ widths ≤ 100 by construction.

function c(dimension: string, score: number, normalizedWeight: number): WaterfallContribution {
  return { dimension, name: `${dimension} name`, score, normalizedWeight, points: score * normalizedWeight };
}

/** Nine dimensions at equal weight — the shipping shape, and the one the floors overflowed. */
function nineAt(scores: number[]): WaterfallContribution[] {
  return scores.map((s, i) => c(`D${i + 1}`, s, 1 / scores.length));
}

describe("waterfallSegments — no segment carries a fabricated width", () => {
  it("gives every segment its exact contribution as its width (no floor)", () => {
    const ranked = [c("D1", 90, 0.5), c("D2", 40, 0.5)];
    const segs = waterfallSegments(ranked);
    expect(segs.map((s) => s.points)).toEqual([45, 20]);
    expect(segs.every((s) => s.count === 1)).toBe(true);
  });

  it("drops a zero-scoring dimension from the track entirely — a zero contributes zero width", () => {
    const segs = waterfallSegments([c("D1", 80, 0.5), c("D2", 0, 0.5)]);
    expect(segs.map((s) => s.key)).toEqual(["D1"]);
  });

  it("renders NOTHING when every dimension scores zero (an all-zero repo has no bar to draw)", () => {
    expect(waterfallSegments(nineAt(Array(9).fill(0)))).toEqual([]);
    // …and the whole track is headroom.
    expect(waterfallHeadroom(0)).toBe(100);
  });

  it("returns no segments for an empty contribution set", () => {
    expect(waterfallSegments([])).toEqual([]);
  });
});

describe("waterfallSegments — micro contributions aggregate instead of being floored or hidden", () => {
  it("rolls two-or-more sub-threshold contributions into ONE neutral sliver at their summed width", () => {
    // Eight tiny + one large: under the old floor those eight each claimed 0.375rem of a track that
    // only had ~2 points of room for all of them combined.
    const ranked = [c("D1", 80, 0.5), ...Array.from({ length: 8 }, (_, i) => c(`D${i + 2}`, 2, 0.0625))];
    const segs = waterfallSegments(ranked);
    expect(segs).toHaveLength(2);
    const agg = segs[1]!;
    expect(agg.count).toBe(8);
    expect(agg.score).toBeNull(); // neutral — it stands for several scores, so it carries none
    expect(agg.points).toBeCloseTo(8 * 2 * 0.0625, 10);
    expect(agg.title).toContain("8 dimensions under");
    expect(agg.title).toContain("D2");
    expect(agg.title).toContain("D9");
  });

  it("leaves a LONE micro contribution as itself — an 'other' of one is just a worse label", () => {
    const segs = waterfallSegments([c("D1", 80, 0.9), c("D2", 5, 0.1)]);
    expect(segs).toHaveLength(2);
    expect(segs[1]!.key).toBe("D2");
    expect(segs[1]!.count).toBe(1);
    expect(segs[1]!.score).toBe(5);
  });

  it("aggregates ALL of them when every dimension is micro (a near-zero repo)", () => {
    const segs = waterfallSegments(nineAt(Array(9).fill(2)));
    expect(segs).toHaveLength(1);
    expect(segs[0]!.count).toBe(9);
    expect(segs[0]!.points).toBeCloseTo(2, 10);
  });

  it("puts the aggregate last — it is by definition the smallest slice", () => {
    const ranked = [c("D1", 60, 0.5), c("D2", 30, 0.4), c("D3", 5, 0.05), c("D4", 4, 0.05)];
    const segs = waterfallSegments(ranked);
    expect(segs.map((s) => s.key)).toEqual(["D1", "D2", "__aggregate__"]);
  });

  it("keeps the threshold at a width that is actually drawable", () => {
    // A regression pin on the constant itself: 1.5 points = 1.5% of the track. Anything smaller is
    // sub-pixel on a narrow card, which is what forced the floor in the first place.
    expect(MICRO_POINTS).toBe(1.5);
    expect(AGGREGATE_HEX).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("waterfallSegments — the track can no longer overflow, so headroom survives", () => {
  it("never sums past 100, at any dimension count or score mix", () => {
    const cases = [
      nineAt([100, 100, 100, 100, 100, 100, 100, 100, 100]),
      nineAt([1, 1, 1, 1, 1, 1, 1, 1, 1]),
      nineAt([99, 3, 2, 1, 1, 1, 1, 1, 1]),
      nineAt([0, 0, 0, 0, 0, 0, 0, 0, 100]),
    ];
    for (const ranked of cases) {
      const sum = waterfallSegments(ranked).reduce((a, s) => a + s.points, 0);
      expect(sum).toBeLessThanOrEqual(100 + 1e-9);
    }
  });

  it("leaves real headroom for the 9-micro-dimension case that used to erase it", () => {
    // The exact reported failure shape: nine low scores. Under the floors the nine 0.375rem minimums
    // ate the track and the headroom tail vanished; now the segments claim 18 points and 82 remain.
    const ranked = nineAt(Array(9).fill(18));
    const drawn = waterfallSegments(ranked).reduce((a, s) => a + s.points, 0);
    expect(drawn).toBeCloseTo(18, 10);
    expect(waterfallHeadroom(drawn)).toBeCloseTo(82, 10);
  });

  it("clamps headroom at zero for a perfect score and never goes negative", () => {
    expect(waterfallHeadroom(100)).toBe(0);
    expect(waterfallHeadroom(100.0001)).toBe(0);
    expect(waterfallHeadroom(0)).toBe(100);
  });
});
