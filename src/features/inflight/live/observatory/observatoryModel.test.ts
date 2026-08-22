import { describe, expect, it } from "vitest";
import { LEVEL_HEX, scoreHex } from "@/lib/ui";
import { POSTURE_THRESHOLD, postureFor } from "@/lib/maturity/model";
import {
  OBSERVATORY_THRESHOLD,
  QUADRANT_POSTURE,
  frontier,
  isPlotted,
  layoutBodies,
  projectX,
  projectY,
  quadrantOf,
  type ObservatorySeed,
} from "./observatoryModel";

const seed = (o: Partial<ObservatorySeed> & { fullName: string }): ObservatorySeed => ({
  name: o.fullName.split("/").pop()!,
  overall: 60,
  adoption: 60,
  rigor: 60,
  level: "L4",
  posture: "ai-native",
  ...o,
});

describe("observatory axes + quadrants", () => {
  it("keys its threshold to the rubric's posture cut, so field and label can't disagree", () => {
    expect(OBSERVATORY_THRESHOLD).toBe(POSTURE_THRESHOLD);
  });

  it("names the same four quadrants postureFor classifies", () => {
    const cases = [
      { x: 70, y: 70 },
      { x: 70, y: 20 },
      { x: 20, y: 70 },
      { x: 20, y: 20 },
    ];
    for (const c of cases) {
      expect(QUADRANT_POSTURE[quadrantOf(c)!]).toBe(postureFor(c.x, c.y).id);
    }
  });

  it("exactly-50 counts as high on both axes (the >= rule)", () => {
    expect(quadrantOf({ x: 50, y: 50 })).toBe("compounding");
    expect(quadrantOf({ x: 49.9, y: 50 })).toBe("rigor-heavy");
  });

  it("has no quadrant without coordinates", () => {
    expect(quadrantOf({ x: null, y: 40 })).toBeNull();
  });
});

describe("frontier", () => {
  it("is the L-shaped boundary of the AI-Native quadrant, not a diagonal", () => {
    const f = frontier();
    expect(f.corner).toEqual({ x: 50, y: 50 });
    expect(f.segments).toHaveLength(2);
    // one vertical run (constant x), one horizontal (constant y)
    expect(f.segments[0]!.x1).toBe(f.segments[0]!.x2);
    expect(f.segments[1]!.y1).toBe(f.segments[1]!.y2);
  });
});

describe("projection", () => {
  it("inverts y so rigor 100 is at the top", () => {
    expect(projectY(100)).toBeLessThan(projectY(0));
    expect(projectX(100)).toBeGreaterThan(projectX(0));
  });
});

describe("layoutBodies", () => {
  it("places a scored repo at its own axis scores", () => {
    const [b] = layoutBodies([seed({ fullName: "acme/api", adoption: 71, rigor: 33 })]);
    expect(b).toMatchObject({ x: 71, y: 33, quadrant: "adoption-heavy", neverScanned: false });
    expect(isPlotted(b!)).toBe(true);
  });

  it("refuses to invent coordinates for a never-scanned repo", () => {
    const [b] = layoutBodies([seed({ fullName: "acme/new", adoption: null, rigor: null, overall: null, level: null })]);
    expect(b!.neverScanned).toBe(true);
    expect(b!.x).toBeNull();
    expect(b!.y).toBeNull();
    expect(b!.trail).toEqual([]);
    expect(isPlotted(b!)).toBe(false);
  });

  it("drops a half-measured repo too (one axis is not a position)", () => {
    const [b] = layoutBodies([seed({ fullName: "acme/half", adoption: 80, rigor: null })]);
    expect(b!.neverScanned).toBe(true);
  });

  it("colours from the level ramp, falling back to the score band without an L id", () => {
    const [a, b] = layoutBodies([
      seed({ fullName: "a/a", level: "L2" }),
      seed({ fullName: "b/b", level: "Practicing", overall: 88 }),
    ]);
    expect(a!.fill).toBe(LEVEL_HEX.L2);
    expect(b!.fill).toBe(scoreHex(88));
  });

  it("gives every body the same radius when no volumes are supplied", () => {
    const bodies = layoutBodies([seed({ fullName: "a/a" }), seed({ fullName: "b/b" })], [], { rDefault: 11 });
    expect(bodies.map((b) => b.r)).toEqual([11, 11]);
  });

  it("scales radius by sqrt(volume) so AREA tracks commit volume", () => {
    const bodies = layoutBodies([seed({ fullName: "a/a" }), seed({ fullName: "b/b" })], [], {
      volumes: { "a/a": 100, "b/b": 25 },
      rMin: 10,
      rMax: 20,
    });
    expect(bodies[0]!.r).toBeCloseTo(20);
    expect(bodies[1]!.r).toBeCloseTo(15); // sqrt(0.25) = 0.5
  });

  it("keeps input order (deterministic layout)", () => {
    const bodies = layoutBodies([seed({ fullName: "z/z" }), seed({ fullName: "a/a" })]);
    expect(bodies.map((b) => b.fullName)).toEqual(["z/z", "a/a"]);
  });
});

describe("trails", () => {
  const hist = (pts: { at: string; adoption?: number | null; rigor?: number | null }[]) => [
    { fullName: "acme/api", points: pts },
  ];

  it("draws only from history points carrying BOTH axes", () => {
    const [b] = layoutBodies(
      [seed({ fullName: "acme/api", adoption: 70, rigor: 70 })],
      hist([
        { at: "1", adoption: 10, rigor: 10 },
        { at: "2", adoption: 30 }, // no rigor → skipped, never back-derived
        { at: "3", adoption: 50, rigor: 40 },
      ]),
    );
    expect(b!.trail).toEqual([
      { x: 10, y: 10, at: "1" },
      { x: 50, y: 40, at: "3" },
    ]);
  });

  it("is empty when history carries no axes at all (today's RepoTrajectoryPoint)", () => {
    const [b] = layoutBodies([seed({ fullName: "acme/api" })], hist([{ at: "1" }, { at: "2" }]));
    expect(b!.trail).toEqual([]);
  });

  it("keeps at most `maxTrail` observations, oldest → newest", () => {
    const [b] = layoutBodies(
      [seed({ fullName: "acme/api", adoption: 90, rigor: 90 })],
      hist([1, 2, 3, 4, 5].map((n) => ({ at: `${n}`, adoption: n * 10, rigor: n * 10 }))),
      { maxTrail: 3 },
    );
    expect(b!.trail.map((p) => p.at)).toEqual(["3", "4", "5"]);
  });

  it("does not repeat the current position as its own trail point", () => {
    const [b] = layoutBodies(
      [seed({ fullName: "acme/api", adoption: 60, rigor: 60 })],
      hist([
        { at: "1", adoption: 40, rigor: 40 },
        { at: "2", adoption: 60, rigor: 60 },
      ]),
    );
    expect(b!.trail.map((p) => p.at)).toEqual(["1"]);
  });
});
