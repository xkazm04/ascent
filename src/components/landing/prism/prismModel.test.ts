import { describe, expect, it } from "vitest";
import { ARCHETYPE_WEIGHTS, DIMENSIONS, LEVELS } from "@/lib/maturity/model";
import {
  ARCHETYPES,
  HUES,
  PRISM_DIMS,
  archetypeShort,
  levelOf,
  lineHash,
  nextLine,
  parseHash,
  pct,
  prevLine,
  weightOf,
} from "./prismModel";

describe("prismModel", () => {
  it("gives every product dimension one distinct hue, in order", () => {
    expect(PRISM_DIMS).toHaveLength(DIMENSIONS.length);
    expect(PRISM_DIMS.map((d) => d.id)).toEqual(DIMENSIONS.map((d) => d.id));
    expect(new Set(PRISM_DIMS.map((d) => d.hue)).size).toBe(PRISM_DIMS.length);
    expect(HUES.length).toBeGreaterThanOrEqual(PRISM_DIMS.length);
  });

  it("reads weights from the rubric for every lens, and each lens sums to 1", () => {
    for (const a of ARCHETYPES) {
      const sum = PRISM_DIMS.reduce((s, _d, i) => s + weightOf(i, a), 0);
      expect(sum).toBeCloseTo(1, 9);
      expect(weightOf(0, a)).toBe(ARCHETYPE_WEIGHTS[a][PRISM_DIMS[0].id]);
    }
  });

  it("formats weights as whole percents and shortens archetype labels", () => {
    expect(pct(0.15)).toBe("15%");
    expect(archetypeShort("solo")).toBe("Solo");
    expect(archetypeShort("org")).toBe("Org");
  });

  it("places scores on the ladder by band, falling back to L1", () => {
    for (const l of LEVELS) {
      expect(levelOf(l.band[0]).id).toBe(l.id);
      expect(levelOf(l.band[1]).id).toBe(l.id);
    }
    expect(levelOf(-5).id).toBe(LEVELS[0].id);
  });

  it("parses the scene hash and round-trips it", () => {
    expect(parseHash("")).toBeNull();
    expect(parseHash("#/")).toBeNull();
    expect(parseHash("#/line/D99")).toBeNull();
    expect(parseHash("#/line/D3")).toEqual({ i: 2, e: null });
    expect(parseHash("#/line/D3/2")).toEqual({ i: 2, e: 1 });
    expect(lineHash(2, 1)).toBe("#/line/D3/2");
    expect(parseHash(lineHash(8))).toEqual({ i: 8, e: null });
  });

  it("wraps the stepper around the nine lines", () => {
    expect(prevLine(0)).toBe(8);
    expect(nextLine(8)).toBe(0);
    expect(nextLine(3)).toBe(4);
  });
});
