import { describe, expect, it } from "vitest";
import { columnAverages, dimScore, hasMissingCells, nextSort, sortRows, type HeatRow } from "./heatmapModel";
import { postureShares } from "./postureModel";

const rows: HeatRow[] = [
  { name: "a", fullName: "o/a", dims: [{ dimId: "D1", score: 90 }, { dimId: "D2", score: 40 }] },
  { name: "b", fullName: "o/b", dims: [{ dimId: "D1", score: 60 }] },
];

describe("heatmap model", () => {
  it("averages only repos that carry the dimension, null when none does", () => {
    expect(columnAverages(rows, ["D1", "D2", "D3"])).toEqual({ D1: 75, D2: 40, D3: null });
  });
  it("reads an absent cell as undefined, never 0", () => {
    expect(dimScore(rows[1], "D2")).toBeUndefined();
  });
  it("cycles weakest-first, strongest-first, reset", () => {
    const s1 = nextSort(null, "D1");
    expect(s1).toEqual({ dim: "D1", dir: 1 });
    const s2 = nextSort(s1, "D1");
    expect(s2).toEqual({ dim: "D1", dir: -1 });
    expect(nextSort(s2, "D1")).toBeNull();
    expect(nextSort(s2, "D2")).toEqual({ dim: "D2", dir: 1 });
  });
  it("ranks missing as weakest and leaves an unsorted list untouched", () => {
    expect(sortRows(rows, null)).toBe(rows);
    expect(sortRows(rows, { dim: "D2", dir: 1 }).map((r) => r.name)).toEqual(["b", "a"]);
    expect(sortRows(rows, { dim: "D1", dir: -1 }).map((r) => r.name)).toEqual(["a", "b"]);
  });
  it("flags missing cells and missing column means for the legend", () => {
    expect(hasMissingCells(rows, ["D1"], { D1: 75 })).toBe(false);
    expect(hasMissingCells(rows, ["D1", "D2"], { D1: 75, D2: 40 })).toBe(true);
    expect(hasMissingCells(rows, ["D1"], { D1: null })).toBe(true);
  });
});

describe("posture shares", () => {
  it("sums to the scored count and never divides by zero", () => {
    const { shares, scored } = postureShares({ "ai-native": 3, early: 1 });
    expect(scored).toBe(4);
    expect(shares.find((s) => s.posture === "ai-native")).toMatchObject({ n: 3, pct: 75 });
    expect(postureShares({}).shares.every((s) => s.share === 0)).toBe(true);
  });
});
