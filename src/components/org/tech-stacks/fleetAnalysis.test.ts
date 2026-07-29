// Unit test for the fleet dimension-analysis logic. Pins the classification thresholds (divergent /
// gap / strength / consistent) and the cross-stack rollup, since these drive what the section tells
// the user — a threshold drift would silently re-label the fleet's strengths and gaps.

import { describe, it, expect } from "vitest";
import { classifyDim, computeFleetInsights, coverageOf } from "@/components/org/tech-stacks/fleetAnalysis";
import type { SegmentSummary } from "@/lib/db";

const stack = (id: string, name: string, dims: Record<string, number>): SegmentSummary => ({
  id,
  name,
  repoCount: 2,
  scannedCount: 2,
  avgOverall: Math.round(Object.values(dims).reduce((a, b) => a + b, 0) / Object.values(dims).length),
  avgAdoption: 50,
  avgRigor: 50,
  posture: "manual",
  dimAverages: Object.entries(dims).map(([dimId, avg]) => ({ dimId, avg })),
});

describe("classifyDim", () => {
  it("labels a wide best-vs-worst gap as divergent", () => {
    expect(classifyDim(20, 60)).toBe("divergent"); // spread 40 ≥ 35
  });
  it("labels a uniformly-low dimension as a systemic gap", () => {
    expect(classifyDim(15, 40)).toBe("gap"); // max ≤ 45, spread < 35
  });
  it("labels a uniformly-high dimension as a shared strength", () => {
    expect(classifyDim(72, 90)).toBe("strength"); // min ≥ 68, spread < 35
  });
  it("labels a clustered mid-range dimension as consistent", () => {
    expect(classifyDim(50, 60)).toBe("consistent");
  });
});

describe("coverageOf", () => {
  it("calls a unanimous read full, a minority read low, and the middle partial", () => {
    expect(coverageOf({ count: 8, scoredCount: 8 }).level).toBe("full");
    expect(coverageOf({ count: 2, scoredCount: 8 }).level).toBe("low"); // 0.25 < 0.6
    expect(coverageOf({ count: 5, scoredCount: 8 }).level).toBe("partial"); // 0.625 ≥ 0.6
  });
  it("never reports a denominator smaller than the contributing count", () => {
    expect(coverageOf({ count: 3, scoredCount: 0 })).toMatchObject({ of: 3, level: "full" });
  });
});

describe("computeFleetInsights", () => {
  const dims = ["D1", "D2", "D3"];
  const stacks = [
    stack("fe", "Frontend", { D1: 90, D2: 30, D3: 55 }),
    stack("be", "Backend", { D1: 50, D2: 35, D3: 58 }),
  ];

  it("returns null when fewer than two stacks are scored", () => {
    expect(computeFleetInsights([stacks[0]!], null, dims)).toBeNull();
  });

  it("classifies each dimension and finds leader/laggard + widest spread", () => {
    const ins = computeFleetInsights(stacks, null, dims)!;
    expect(ins).not.toBeNull();
    const d1 = ins.dims.find((d) => d.dimId === "D1")!;
    expect(d1.klass).toBe("divergent"); // 90 vs 50, spread 40
    expect(d1.leader.name).toBe("Frontend");
    expect(d1.laggard.name).toBe("Backend");
    expect(ins.gaps.map((d) => d.dimId)).toContain("D2"); // 30/35 both low
    expect(ins.widest?.dimId).toBe("D1"); // biggest spread
    // most-actionable-first: a divergent dimension outranks a consistent one
    expect(ins.dims[0]!.klass).toBe("divergent");
  });

  it("carries the scored-stack denominator on the analysis and on every insight", () => {
    // A third stack that carries only D1 — so D2/D3 are evidenced by 2 of 3 scored stacks, not 3.
    const partial = [...stacks, stack("mo", "Mobile", { D1: 20 })];
    const ins = computeFleetInsights(partial, null, dims)!;
    expect(ins.scoredCount).toBe(3);
    expect(ins.dims.find((d) => d.dimId === "D1")!).toMatchObject({ count: 3, scoredCount: 3 });
    expect(ins.dims.find((d) => d.dimId === "D2")!).toMatchObject({ count: 2, scoredCount: 3 });
  });

  it("reports the overall best-vs-worst stack spread", () => {
    const ins = computeFleetInsights(stacks, null, dims)!;
    expect(ins.overall?.leader.name).toBe("Frontend"); // avg 58 vs 47
    expect(ins.overall?.laggard.name).toBe("Backend");
  });
});
