// Parity gate: the Dimensions tab (dimFacts -> DimensionReading / DimensionDetail) and the Scoring
// tab (contributions() -> ScoreWaterfall) state the same fact - one dimension's share of the
// headline - and must agree on every scan shape, including the degraded ones where a dimension was
// dropped and the lens weights no longer sum to 1. Both now read dimensionShares(); this test keeps
// the next change to either side from re-forking them silently.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DimensionId, DimensionResult, ScanReport } from "@/lib/types";
import { ARCHETYPE_WEIGHTS } from "@/lib/maturity/model";
import { contributions, dimensionShares } from "@/lib/scoring/projections";
import { dimFacts } from "@/components/report/dimensionExplorerDerive";
import { DimensionReading } from "@/components/report/DimensionReading";
import { DimensionDetail } from "@/components/report/DimensionDetail";

const dim = (id: DimensionId, score: number, weight: number): DimensionResult => ({
  id,
  name: id,
  score,
  weight,
  signalScore: score,
  llmScore: score,
  summary: "",
  evidence: [],
  strengths: [],
  gaps: [],
});

const SCORES: Record<DimensionId, number> = { D1: 72, D2: 40, D3: 55, D4: 61, D5: 30, D6: 88, D7: 47, D8: 66, D9: 12 };
const lens = (archetype: keyof typeof ARCHETYPE_WEIGHTS, drop: DimensionId[] = []): DimensionResult[] =>
  (Object.keys(ARCHETYPE_WEIGHTS[archetype]) as DimensionId[])
    .filter((id) => !drop.includes(id))
    .map((id) => dim(id, SCORES[id], ARCHETYPE_WEIGHTS[archetype][id]));
const report = (dimensions: DimensionResult[]): ScanReport => ({ overallScore: 50, dimensions }) as unknown as ScanReport;

const FIXTURES: Record<string, DimensionResult[]> = {
  "full 9-dimension org": lens("org"),
  "D9-dropped org": lens("org", ["D9"]),
  "single dimension": [dim("D2", 40, 0.15)],
  "all-zero scores": lens("org").map((d) => ({ ...d, score: 0 })),
  "team lens": lens("team"),
};

describe("dimension share parity: explorer vs waterfall", () => {
  for (const [name, dims] of Object.entries(FIXTURES)) {
    it(`agrees on every dimension's share and points - ${name}`, () => {
      const shares = dimensionShares(dims);
      const waterfall = contributions(report(dims)).dimensions;
      expect(waterfall).toHaveLength(dims.length);
      for (const c of waterfall) {
        const d = dims.find((x) => x.id === c.dimension)!;
        const f = dimFacts(d, undefined, null, shares.get(d.id));
        expect(f.share).toBe(c.normalizedWeight);
        expect(Math.abs(f.contributes - c.points)).toBeLessThan(1e-9);
        expect(Math.abs(f.headroom - c.normalizedWeight * (100 - c.score))).toBeLessThan(1e-9);
      }
    });
  }

  it("a full scan's shares are the raw lens weights (the numbers every full report shows today)", () => {
    for (const archetype of ["org", "team", "solo"] as const) {
      const dims = lens(archetype);
      const shares = dimensionShares(dims);
      for (const d of dims) {
        expect(Math.abs(shares.get(d.id)! - d.weight)).toBeLessThan(1e-9);
        expect(Math.round(shares.get(d.id)! * 100)).toBe(Math.round(d.weight * 100));
      }
    }
  });
});

describe("the weight% a reader sees on a dropped-dimension scan", () => {
  const dims = FIXTURES["D9-dropped org"]!;
  const shares = dimensionShares(dims);
  const d2 = dims.find((d) => d.id === "D2")!;
  // What ScoreWaterfall prints for this row: `{score} x {Math.round(normalizedWeight * 100)}%`.
  const waterfallPct = Math.round(contributions(report(dims)).dimensions.find((c) => c.dimension === "D2")!.normalizedWeight * 100);

  it("the waterfall's percent for D2 is 16 (0.15 / 0.91)", () => {
    expect(waterfallPct).toBe(16);
  });

  it("DimensionReading prints the same normalized weight the waterfall prints", () => {
    const html = renderToStaticMarkup(createElement(DimensionReading, { f: dimFacts(d2, undefined, null, shares.get("D2")) }));
    expect(html).toContain(`weight ${waterfallPct}%`);
    expect(html).not.toContain("weight 15%");
    expect(html).not.toContain("\u2014 weight");
  });

  it("DimensionDetail's headline prints the normalized weight, not the raw lens weight", () => {
    const html = renderToStaticMarkup(createElement(DimensionDetail, { d: d2, share: shares.get("D2") }));
    expect(html).toContain(`weight ${waterfallPct}%`);
    expect(html).not.toContain("weight 15%");
  });
});
