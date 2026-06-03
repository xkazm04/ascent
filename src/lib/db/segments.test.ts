import { describe, expect, it } from "vitest";
import { buildSegmentComparison, normalizeColor, normalizeSegmentName, type SegmentSummary } from "@/lib/db/segments";

// Pure helpers behind the segments layer (name/color sanitization + the side-by-side diff) — no DB.

describe("normalizeSegmentName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeSegmentName("  platform  ")).toBe("platform");
  });
  it("caps the length at 60 chars", () => {
    expect(normalizeSegmentName("x".repeat(80))).toHaveLength(60);
  });
});

describe("normalizeColor", () => {
  it("accepts a 6-digit hex and lowercases it", () => {
    expect(normalizeColor("#A1B2C3")).toBe("#a1b2c3");
  });
  it("accepts a 3-digit hex", () => {
    expect(normalizeColor("#abc")).toBe("#abc");
  });
  it("falls back to the brand accent for malformed or empty input", () => {
    expect(normalizeColor("red")).toBe("#3b9eff");
    expect(normalizeColor("#12")).toBe("#3b9eff");
    expect(normalizeColor("")).toBe("#3b9eff");
    expect(normalizeColor(null)).toBe("#3b9eff");
    expect(normalizeColor(undefined)).toBe("#3b9eff");
  });
});

function summary(over: Partial<SegmentSummary>): SegmentSummary {
  return {
    id: "s",
    name: "seg",
    repoCount: 0,
    scannedCount: 0,
    avgOverall: 0,
    avgAdoption: 0,
    avgRigor: 0,
    posture: "early",
    dimAverages: [],
    ...over,
  };
}

describe("buildSegmentComparison", () => {
  it("computes signed headline deltas as a − b", () => {
    const a = summary({ name: "platform", avgOverall: 80, avgAdoption: 85, avgRigor: 70 });
    const b = summary({ name: "legacy", avgOverall: 50, avgAdoption: 40, avgRigor: 60 });
    const c = buildSegmentComparison(a, b);
    expect(c.a.name).toBe("platform");
    expect(c.b.name).toBe("legacy");
    expect(c.deltas).toEqual({ overall: 30, adoption: 45, rigor: 10 });
  });

  it("unions dimensions from both sides (sorted) and treats a missing side as 0", () => {
    const a = summary({ dimAverages: [{ dimId: "D2", avg: 60 }, { dimId: "D1", avg: 90 }] });
    const b = summary({ dimAverages: [{ dimId: "D1", avg: 40 }, { dimId: "D8", avg: 30 }] });
    const c = buildSegmentComparison(a, b);
    expect(c.dimDeltas.map((d) => d.dimId)).toEqual(["D1", "D2", "D8"]);
    expect(c.dimDeltas).toContainEqual({ dimId: "D1", a: 90, b: 40, delta: 50 });
    expect(c.dimDeltas).toContainEqual({ dimId: "D2", a: 60, b: 0, delta: 60 }); // absent in b
    expect(c.dimDeltas).toContainEqual({ dimId: "D8", a: 0, b: 30, delta: -30 }); // absent in a
  });
});
