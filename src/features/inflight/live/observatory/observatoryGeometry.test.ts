import { describe, expect, it } from "vitest";
import { layoutBodies, type ObservatoryBody, type ObservatorySeed, type PlottedBody } from "./observatoryModel";
import {
  clusterBodies,
  driftPath,
  driftPoint,
  isCluster,
  lassoHitTest,
  pointInPolygon,
  rectPolygon,
} from "./observatoryGeometry";
import { lerpHex } from "./observatoryMotion";

const seeds = (n: number, at: (i: number) => { adoption: number; rigor: number }): ObservatorySeed[] =>
  Array.from({ length: n }, (_, i) => ({
    fullName: `acme/repo-${i}`,
    name: `repo-${i}`,
    overall: 60,
    level: "L4",
    posture: "ai-native",
    ...at(i),
  }));

const plot = (bodies: ObservatoryBody[]) => bodies as PlottedBody[];

describe("clusterBodies", () => {
  it("returns every body as itself at or below the threshold", () => {
    const bodies = layoutBodies(seeds(10, () => ({ adoption: 60, rigor: 60 })));
    const out = clusterBodies(bodies, 40);
    expect(out).toHaveLength(10);
    expect(out.every((i) => !isCluster(i))).toBe(true);
  });

  it("aggregates co-located bodies into cells once above the threshold", () => {
    const bodies = layoutBodies(seeds(50, () => ({ adoption: 80, rigor: 80 })));
    const out = clusterBodies(bodies, 40, 6);
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(isCluster(c)).toBe(true);
    if (!isCluster(c)) return;
    expect(c.count).toBe(50);
    expect(c.members).toHaveLength(50);
    expect(c.quadrant).toBe("compounding");
  });

  it("leaves a lone body in its own cell unclustered", () => {
    // 44 bodies packed into one cell + 1 far away → one cluster, one plain body.
    const bodies = layoutBodies(seeds(45, (i) => (i === 44 ? { adoption: 5, rigor: 5 } : { adoption: 80, rigor: 80 })));
    const out = clusterBodies(bodies, 40, 6);
    expect(out.filter(isCluster)).toHaveLength(1);
    expect(out.filter((i) => !isCluster(i))).toHaveLength(1);
  });

  it("never plots a never-scanned repo", () => {
    const bodies = layoutBodies([
      { fullName: "a/a", name: "a", overall: null, adoption: null, rigor: null, level: null, posture: null },
    ]);
    expect(clusterBodies(bodies, 0)).toEqual([]);
  });

  it("is deterministic in cell order", () => {
    const bodies = layoutBodies(seeds(60, (i) => ({ adoption: (i % 6) * 16 + 4, rigor: 80 })));
    const a = clusterBodies(bodies, 40).map((i) => (isCluster(i) ? i.id : i.fullName));
    const b = clusterBodies(bodies, 40).map((i) => (isCluster(i) ? i.id : i.fullName));
    expect(a).toEqual(b);
  });
});

describe("pointInPolygon / lassoHitTest", () => {
  const box = rectPolygon({ x: 40, y: 40 }, { x: 90, y: 90 });

  it("tests a rectangle correctly", () => {
    expect(pointInPolygon(box, { x: 60, y: 60 })).toBe(true);
    expect(pointInPolygon(box, { x: 10, y: 60 })).toBe(false);
    expect(pointInPolygon([], { x: 1, y: 1 })).toBe(false);
  });

  it("selects the bodies inside the lasso, by full name", () => {
    const bodies = plot(
      layoutBodies([
        { fullName: "in/one", name: "one", overall: 70, adoption: 60, rigor: 60, level: "L4", posture: null },
        { fullName: "out/two", name: "two", overall: 20, adoption: 10, rigor: 10, level: "L1", posture: null },
      ]),
    );
    expect(lassoHitTest(box, bodies)).toEqual(["in/one"]);
  });

  it("catches a cluster by its centre and returns all its members", () => {
    const bodies = layoutBodies(seeds(50, () => ({ adoption: 80, rigor: 80 })));
    const items = clusterBodies(bodies, 40);
    expect(lassoHitTest(box, items)).toHaveLength(50);
    expect(lassoHitTest(rectPolygon({ x: 0, y: 0 }, { x: 20, y: 20 }), items)).toEqual([]);
  });
});

describe("driftPath / driftPoint", () => {
  it("emits a quadratic arc between the two positions", () => {
    expect(driftPath({ x: 0, y: 0 }, { x: 10, y: 0 })).toMatch(/^M 0 0 Q .* 10 0$/);
  });

  it("starts at `before`, ends at `after`, and bows off the chord in between", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(driftPoint(a, b, 0)).toEqual(a);
    expect(driftPoint(a, b, 1)).toEqual(b);
    const mid = driftPoint(a, b, 0.5);
    expect(mid.x).toBeCloseTo(5);
    expect(mid.y).not.toBeCloseTo(0); // the curve, not the chord
    expect(driftPoint(a, b, 0.5, 0).y).toBeCloseTo(0); // bow 0 = straight
  });
});

describe("lerpHex", () => {
  it("walks the level ramp between two brand hexes", () => {
    expect(lerpHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(lerpHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(lerpHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("clamps out-of-range progress", () => {
    expect(lerpHex("#000000", "#ffffff", 2)).toBe("#ffffff");
    expect(lerpHex("#000000", "#ffffff", -1)).toBe("#000000");
  });
});
