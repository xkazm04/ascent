import { describe, it, expect } from "vitest";
import { DIMENSIONS, ARCHETYPE_WEIGHTS } from "@/lib/maturity/model";
import {
  buildMatrixRows,
  MAX_WEIGHT,
  TRACK_MAX,
  pct,
  ARCHETYPE_COLUMNS,
} from "./matrixData";

describe("matrixData", () => {
  const rows = buildMatrixRows();

  it("builds one row per dimension, in rubric order", () => {
    expect(rows).toHaveLength(DIMENSIONS.length);
    expect(rows.map((r) => r.id)).toEqual(DIMENSIONS.map((d) => d.id));
  });

  it("mirrors the real ARCHETYPE_WEIGHTS and base weight for every cell", () => {
    for (const r of rows) {
      expect(r.base).toBe(DIMENSIONS.find((d) => d.id === r.id)!.weight);
      expect(r.solo).toBe(ARCHETYPE_WEIGHTS.solo[r.id]);
      expect(r.team).toBe(ARCHETYPE_WEIGHTS.team[r.id]);
      expect(r.org).toBe(ARCHETYPE_WEIGHTS.org[r.id]);
    }
  });

  it("exposes exactly the three archetype lenses as columns", () => {
    expect(ARCHETYPE_COLUMNS.map((c) => c.key)).toEqual(["solo", "team", "org"]);
  });

  it("MAX_WEIGHT is the largest single lens weight", () => {
    const all = rows.flatMap((r) => [r.solo, r.team, r.org]);
    expect(MAX_WEIGHT).toBe(Math.max(...all));
  });

  it("TRACK_MAX is the heaviest weight rounded up to a 5% boundary, so bars stay proportional to the printed percent", () => {
    expect(TRACK_MAX).toBeGreaterThanOrEqual(MAX_WEIGHT); // never clips the heaviest bar
    expect(Math.round(TRACK_MAX * 20)).toBeCloseTo(TRACK_MAX * 20, 9); // a multiple of 0.05 (5%)
  });

  it("formats weights as whole-number percents", () => {
    expect(pct(0.15)).toBe("15%");
    expect(pct(0.2)).toBe("20%");
  });
});
