import { describe, expect, it } from "vitest";
import type { DimensionId, ScanReport } from "@/lib/types";
import { MIXED_ENGINE_PAIR_LABEL, MIXED_ENGINE_PAIR_NOTE } from "@/components/report/chartEngine";
import { bridgeTenthsTotal, scoreBridge, type ReportBaseline } from "@/components/report/scoreBridgeModel";

// charts-1: the waterfall explains the MOVE. Each step is the dimension's CURRENT share (from
// dimensionShares, the one derivation) times its score delta, and one residual makes the bridge sum
// exactly to the headline delta the DeltaPill shows.

type Dim = { id: DimensionId; score: number; weight: number };

function report(overall: number, dims: Dim[], engine = "claude", rubricVersion: string | undefined = "r24"): ScanReport {
  return {
    overallScore: overall,
    dimensions: dims.map((d) => ({ ...d, name: `${d.id} name` })),
    engine: { provider: engine, model: "m", ...(rubricVersion ? { rubricVersion } : {}) },
  } as unknown as ScanReport;
}

function baseline(
  overall: number,
  dims: { dimId: string; score: number }[] | undefined,
  engineProvider = "claude",
  rubricVersion: string | null = "r24",
): ReportBaseline {
  return { id: "b1", overallScore: overall, engineProvider, rubricVersion, ...(dims ? { dimensions: dims } : {}) };
}

const NOW = report(62, [
  { id: "D1", score: 60, weight: 0.71 },
  { id: "D2", score: 70, weight: 0.15 },
  { id: "D3", score: 40, weight: 0.14 },
]);
const BEFORE = baseline(58, [
  { dimId: "D1", score: 60 },
  { dimId: "D2", score: 50 },
  { dimId: "D3", score: 45 },
]);

describe("scoreBridge - points by dimension, summing to the delta", () => {
  it("steps are share x score delta, biggest |pts| first, unchanged omitted, residual last", () => {
    const b = scoreBridge(NOW, BEFORE);
    if (b.kind !== "bridge") throw new Error("expected a bridge");
    expect(b.from).toBe(58);
    expect(b.to).toBe(62);
    expect(b.delta).toBe(4);
    expect(b.steps.map((s) => [s.kind, s.dimension, s.points])).toEqual([
      ["moved", "D2", 3],
      ["moved", "D3", -0.7],
      ["residual", null, 1.7],
    ]);
    expect(b.steps.find((s) => s.dimension === "D1")).toBeUndefined();
    expect(b.steps.at(-1)?.label).toBe("rounding & reweighting");
    // Exactly, in integer tenths: from + sum(steps) === to.
    expect(b.from + bridgeTenthsTotal(b.steps) / 10).toBe(b.to);
  });

  it("sums exactly on awkward shares (no float drift)", () => {
    const now = report(71, [
      { id: "D1", score: 77, weight: 1 / 3 },
      { id: "D2", score: 64, weight: 1 / 3 },
      { id: "D3", score: 73, weight: 1 / 3 },
    ]);
    const b = scoreBridge(now, baseline(63, [{ dimId: "D1", score: 61 }, { dimId: "D2", score: 59 }, { dimId: "D3", score: 70 }]));
    if (b.kind !== "bridge") throw new Error("expected a bridge");
    expect(b.from + bridgeTenthsTotal(b.steps) / 10).toBe(b.to);
  });

  it("omits the residual step when the dimension steps already sum to the delta", () => {
    const now = report(55, [{ id: "D1", score: 60, weight: 0.5 }, { id: "D2", score: 50, weight: 0.5 }]);
    const b = scoreBridge(now, baseline(50, [{ dimId: "D1", score: 50 }, { dimId: "D2", score: 50 }]));
    if (b.kind !== "bridge") throw new Error("expected a bridge");
    expect(b.steps.map((s) => s.kind)).toEqual(["moved"]);
  });
});

describe("scoreBridge - entered and left dimensions are their own steps", () => {
  it("a dimension new since the baseline is 'entered' with share x score; a dropped one is 'left'", () => {
    const now = report(60, [{ id: "D1", score: 60, weight: 0.8 }, { id: "D9", score: 50, weight: 0.2 }]);
    const b = scoreBridge(now, baseline(57, [{ dimId: "D1", score: 60 }, { dimId: "D4", score: 30 }]));
    if (b.kind !== "bridge") throw new Error("expected a bridge");
    const entered = b.steps.find((s) => s.kind === "entered");
    expect(entered?.dimension).toBe("D9");
    expect(entered?.points).toBe(10);
    const left = b.steps.find((s) => s.kind === "left");
    expect(left?.dimension).toBe("D4");
    expect(left?.scoreBefore).toBe(30);
    // The left dimension's baseline weight is not recorded, so it carries no fabricated points; it is
    // still a NAMED step, not silently inside the residual.
    expect(left?.points).toBeNull();
    expect(b.from + bridgeTenthsTotal(b.steps) / 10).toBe(b.to);
  });
});

describe("scoreBridge - unavailable states", () => {
  it("no baseline -> no-baseline", () => {
    expect(scoreBridge(NOW, null)).toEqual({ kind: "unavailable", reason: "no-baseline" });
  });
  it("baseline without dimensions (history join skipped) -> no-dimensions", () => {
    expect(scoreBridge(NOW, baseline(58, undefined))).toEqual({ kind: "unavailable", reason: "no-dimensions" });
  });
});

describe("scoreBridge - caveats reuse the existing vocabulary", () => {
  it("mock baseline vs live now -> mixed-engines with MIXED_ENGINE_PAIR_NOTE, steps still drawn", () => {
    const b = scoreBridge(NOW, { ...BEFORE, engineProvider: "mock" });
    if (b.kind !== "bridge") throw new Error("expected a bridge");
    const c = b.caveats.find((x) => x.id === "mixed-engines");
    expect(c?.note).toBe(MIXED_ENGINE_PAIR_NOTE);
    expect(c?.label).toBe(MIXED_ENGINE_PAIR_LABEL);
    expect(b.steps.length).toBeGreaterThan(0);
  });

  it("provably different rubrics -> rubric-changed naming both", () => {
    const b = scoreBridge(NOW, { ...BEFORE, rubricVersion: "r23" });
    if (b.kind !== "bridge") throw new Error("expected a bridge");
    const c = b.caveats.find((x) => x.id === "rubric-changed");
    expect(c?.label).toBe("Scored under different rubrics");
    expect(c?.note).toContain("r23");
    expect(c?.note).toContain("r24");
  });

  it("a legacy baseline with no rubric stamp -> rubric-unknown", () => {
    const b = scoreBridge(NOW, { ...BEFORE, rubricVersion: null });
    if (b.kind !== "bridge") throw new Error("expected a bridge");
    expect(b.caveats.map((x) => x.id)).toEqual(["rubric-unknown"]);
  });

  it("same ruler and same kind of engine -> no caveat", () => {
    const b = scoreBridge(NOW, BEFORE);
    if (b.kind !== "bridge") throw new Error("expected a bridge");
    expect(b.caveats).toEqual([]);
  });

  it("new copy carries no em dash", () => {
    const b = scoreBridge(NOW, { ...BEFORE, rubricVersion: null, engineProvider: "mock" });
    const b2 = scoreBridge(NOW, { ...BEFORE, rubricVersion: "r1" });
    const text = JSON.stringify([b, b2]);
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});
