import { describe, it, expect } from "vitest";
import { assembleReport, contributions, diffReports, projectSandbox } from "./engine";
import { DIMENSIONS, LEVEL_BY_ID, axisScore, levelForScore, overallScoreFor, postureFor } from "@/lib/maturity/model";
import { MockProvider } from "@/lib/llm/mock";
import type { DimensionResult, DimensionSignals, LlmAssessment, RepoSnapshot, ScanReport } from "@/lib/types";

/** All 8 dimensions at a baseline, with per-dimension score/signal/evidence/gap overrides. */
function dims(
  overrides: Record<
    string,
    { score?: number; signalScore?: number; evidence?: string[]; gaps?: string[] }
  > = {},
): DimensionResult[] {
  return DIMENSIONS.map((d) => {
    const o = overrides[d.id];
    const score = o?.score ?? 50;
    return {
      id: d.id,
      name: d.name,
      weight: d.weight,
      score,
      signalScore: o?.signalScore ?? score,
      llmScore: score,
      summary: "",
      evidence: o?.evidence ?? [],
      strengths: [],
      gaps: o?.gaps ?? [],
    };
  });
}

function mkReport(p: Partial<ScanReport> & { overallScore: number; level: keyof typeof LEVEL_BY_ID }): ScanReport {
  const adoption = p.adoptionScore ?? 50;
  const rigor = p.rigorScore ?? 50;
  return {
    repo: { owner: "acme", name: "widget", url: "", stars: 0, forks: 0, defaultBranch: "main", headSha: p.repo?.headSha },
    overallScore: p.overallScore,
    level: LEVEL_BY_ID[p.level],
    archetype: p.archetype ?? "org",
    adoptionScore: adoption,
    rigorScore: rigor,
    posture: postureFor(adoption, rigor),
    aiUsage: { detected: false, commitFraction: 0, signals: [] },
    contributors: [],
    dimensions: p.dimensions ?? dims(),
    headline: "",
    strengths: [],
    risks: [],
    roadmap: [],
    discrepancies: [],
    confidence: 0.8,
    scannedAt: p.scannedAt ?? "2026-01-01T00:00:00.000Z",
    engine: { provider: "mock", model: "mock" },
  };
}

describe("diffReports", () => {
  it("explains movement between two full reports via concrete signals", () => {
    const prev = mkReport({
      overallScore: 40,
      level: "L2",
      dimensions: dims({ D2: { score: 40, evidence: ["Found 6 test files"] } }),
    });
    const curr = mkReport({
      overallScore: 52,
      level: "L3",
      dimensions: dims({
        D2: { score: 52, evidence: ["Found 18 test files", "Coverage tracking configured"] },
      }),
    });

    const diff = diffReports(prev, curr);

    expect(diff.overall.delta).toBe(12);
    expect(diff.level.changed).toBe(true);
    expect(diff.level.up).toBe(true);

    const d2 = diff.dimensions.find((d) => d.id === "D2")!;
    expect(d2.delta).toBe(12);
    expect(d2.appearedSignals).toEqual(["Found 18 test files", "Coverage tracking configured"]);
    expect(d2.disappearedSignals).toEqual(["Found 6 test files"]);
    expect(diff.movements.some((m) => m.startsWith("D2 +12"))).toBe(true);

    // A live report carries no recommendation statuses, so nothing can move to done.
    expect(diff.recsMovedToDone).toEqual([]);
  });

  it("flags two identical reports as unchanged", () => {
    const r = mkReport({ overallScore: 50, level: "L3", dimensions: dims({ D1: { evidence: ["Found CLAUDE.md"] } }) });
    const diff = diffReports(r, mkReport({ overallScore: 50, level: "L3", dimensions: dims({ D1: { evidence: ["Found CLAUDE.md"] } }) }));
    expect(diff.unchanged).toBe(true);
    expect(diff.appearedSignalCount).toBe(0);
    expect(diff.movements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// assembleReport — dimension reconciliation (#8) + overall roll-up parity (#4)
// ---------------------------------------------------------------------------

function blankSnap(): RepoSnapshot {
  return {
    meta: { owner: "acme", name: "widget", url: "", stars: 0, forks: 0, defaultBranch: "main" },
    tree: [],
    files: [],
    commits: [],
    truncated: false,
    coverage: 1,
  };
}
function signalsFor(scores: Partial<Record<string, number>>): DimensionSignals[] {
  return Object.entries(scores).map(([id, signalScore]) => ({
    id: id as DimensionSignals["id"],
    signalScore: signalScore as number,
    signals: [{ label: `${id} signal` }],
  }));
}
const emptyAssessment: LlmAssessment = {
  dimensions: [],
  headline: "",
  strengths: [],
  risks: [],
  roadmap: [],
  discrepancies: [],
};

describe("assembleReport — LLM/signal dimension reconciliation (#8)", () => {
  it("warns when the LLM scores a dimension absent from the signal set", () => {
    const assessment: LlmAssessment = {
      ...emptyAssessment,
      dimensions: [{ id: "D9", score: 80, summary: "", strengths: [], gaps: [] }],
    };
    const report = assembleReport(
      blankSnap(),
      signalsFor({ D1: 50, D2: 50 }),
      assessment,
      { name: "gemini", model: "x" },
      "2026-01-01T00:00:00Z",
      "org",
    );
    expect((report.warnings ?? []).some((w) => /D9/.test(w) && /signal set/i.test(w))).toBe(true);
  });

  it("does not warn when every LLM dimension is in the signal set", () => {
    const assessment: LlmAssessment = {
      ...emptyAssessment,
      dimensions: [{ id: "D1", score: 60, summary: "", strengths: [], gaps: [] }],
    };
    const report = assembleReport(
      blankSnap(),
      signalsFor({ D1: 50, D2: 50 }),
      assessment,
      { name: "gemini", model: "x" },
      "2026-01-01T00:00:00Z",
      "org",
    );
    expect((report.warnings ?? []).some((w) => /signal set/i.test(w))).toBe(false);
  });
});

describe("overall roll-up parity — mock matches engine (#4)", () => {
  it("overallScoreFor renormalizes over present weights (a partial set doesn't deflate)", () => {
    // 4 of 9 dimensions, all at 90 → renormalized mean is 90, not the raw weighted sum (~50).
    const partial = [
      { id: "D1" as const, score: 90 },
      { id: "D2" as const, score: 90 },
      { id: "D3" as const, score: 90 },
      { id: "D4" as const, score: 90 },
    ];
    expect(overallScoreFor(partial, "org")).toBe(90);
  });

  it("MockProvider's headline level agrees with the engine's renormalized overall", async () => {
    // A partial signal set is exactly where the old raw-weighted-sum mock diverged from the engine.
    const signals = signalsFor({ D1: 90, D2: 90, D3: 90, D4: 90 });
    const mock = new MockProvider();
    const assessment = await mock.assess({
      repo: blankSnap().meta,
      signals,
      files: [],
      commitSample: [],
      archetype: "org",
    });
    const report = assembleReport(blankSnap(), signals, assessment, mock, "2026-01-01T00:00:00Z", "org");

    const expectedOverall = overallScoreFor(
      signals.map((s) => ({ id: s.id, score: s.signalScore })),
      "org",
    );
    expect(report.overallScore).toBe(expectedOverall);
    expect(report.level.id).toBe(levelForScore(expectedOverall).id);
    // The mock's headline announces the SAME level as the engine's badge (the divergence the fix removed).
    expect(report.headline).toContain(report.level.id);
  });
});

// ---------------------------------------------------------------------------
// contributions — glass-box per-dimension attribution of the headline
// ---------------------------------------------------------------------------

describe("contributions — glass-box score attribution", () => {
  it("decomposes the headline into per-dimension points that sum back to the overall", () => {
    const dimensions = dims({
      D1: { score: 90 },
      D2: { score: 30 },
      D5: { score: 70 },
      D9: { score: 10 },
    });
    const overall = overallScoreFor(
      dimensions.map((d) => ({ id: d.id, score: d.score })),
      "org",
    );
    const report = mkReport({ overallScore: overall, level: levelForScore(overall).id, dimensions });

    const { dimensions: parts, total } = contributions(report);

    // One contribution per dimension, in report order.
    expect(parts.map((p) => p.dimension)).toEqual(dimensions.map((d) => d.id));
    // The parts reconstruct the headline — the auditability guarantee the waterfall relies on.
    const sumPoints = parts.reduce((a, p) => a + p.points, 0);
    expect(sumPoints).toBeCloseTo(total, 9);
    expect(Math.round(total)).toBe(report.overallScore);
    // Renormalized weights are a true distribution.
    expect(parts.reduce((a, p) => a + p.normalizedWeight, 0)).toBeCloseTo(1, 9);
  });

  it("signs each contribution by whether the dimension beats the weighted mean (residual = rounding only)", () => {
    const dimensions = dims({ D1: { score: 90 }, D2: { score: 20 } });
    const overall = overallScoreFor(dimensions.map((d) => ({ id: d.id, score: d.score })), "org");
    const report = mkReport({ overallScore: overall, level: levelForScore(overall).id, dimensions });

    const { dimensions: parts, total } = contributions(report);

    // Deviations from the headline sum to exactly (total − rounded overall) — i.e. only the
    // sub-point rounding residual, never a structural imbalance.
    const sumSigned = parts.reduce((a, p) => a + p.signed, 0);
    expect(sumSigned).toBeCloseTo(total - report.overallScore, 9);
    expect(Math.abs(sumSigned)).toBeLessThan(0.5);
    // A dimension above the overall lifts it (positive); one below drags it (negative).
    expect(parts.find((p) => p.dimension === "D1")!.signed).toBeGreaterThan(0);
    expect(parts.find((p) => p.dimension === "D2")!.signed).toBeLessThan(0);
  });

  it("a dimension's points equal its renormalized weight times its score", () => {
    const dimensions = dims({ D1: { score: 80 } });
    const report = mkReport({ overallScore: 50, level: "L3", dimensions });
    const { dimensions: parts } = contributions(report);
    const d1 = parts.find((p) => p.dimension === "D1")!;
    expect(d1.points).toBeCloseTo(d1.normalizedWeight * 80, 9);
    expect(d1.weight).toBe(DIMENSIONS.find((d) => d.id === "D1")!.weight);
  });

  it("never divides by zero when no dimension carries weight", () => {
    // Degenerate guard: a report whose dimensions all have zero weight yields zeroed parts, not NaN.
    const zeroWeighted = dims().map((d) => ({ ...d, weight: 0 }));
    const report = mkReport({ overallScore: 0, level: "L1", dimensions: zeroWeighted });
    const { dimensions: parts, total } = contributions(report);
    expect(total).toBe(0);
    expect(parts.every((p) => p.normalizedWeight === 0 && p.points === 0 && p.signed === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// projectSandbox — the interactive Roadmap Sandbox's live what-if recompute
// ---------------------------------------------------------------------------

describe("projectSandbox — live what-if recompute", () => {
  /** A self-consistent report: its stored overall/adoption/rigor/posture are derived from its
   *  own dimensions via the same engine functions, so the no-override invariant is a real test. */
  function consistent(scores: Record<string, number> = {}): ScanReport {
    const dimList = dims(Object.fromEntries(Object.entries(scores).map(([id, score]) => [id, { score }])));
    const scoreFor = (id: string) => dimList.find((d) => d.id === id)?.score ?? 0;
    const overall = overallScoreFor(dimList.map((d) => ({ id: d.id, score: d.score })), "org");
    const adoption = axisScore("adoption", scoreFor, "org");
    const rigor = axisScore("rigor", scoreFor, "org");
    return mkReport({
      overallScore: overall,
      level: levelForScore(overall).id,
      adoptionScore: adoption,
      rigorScore: rigor,
      dimensions: dimList,
    });
  }

  it("with no overrides reproduces the report's own numbers exactly", () => {
    const report = consistent({ D2: 30, D4: 70, D8: 55 });
    const p = projectSandbox(report, {});
    expect(p.overall.overallScore).toBe(report.overallScore);
    expect(p.overall.deltaScore).toBe(0);
    expect(p.overall.levelUp).toBe(false);
    expect(p.adoptionScore).toBe(report.adoptionScore);
    expect(p.rigorScore).toBe(report.rigorScore);
    expect(p.posture.id).toBe(report.posture.id);
    expect(p.dimensions).toEqual(report.dimensions);
  });

  it("raising the rigor axis to 100 lifts overall, flips posture, and levels up", () => {
    // Everything at 40 → overall 40 (L2), both axes 40 → "early" posture.
    const all40 = Object.fromEntries(DIMENSIONS.map((d) => [d.id, 40]));
    const report = consistent(all40);
    expect(report.overallScore).toBe(40);
    expect(report.posture.id).toBe("early");
    // Max out every rigor dimension; adoption (D1/D4/D7) stays at 40.
    const rigorMax = { D2: 100, D3: 100, D5: 100, D6: 100, D8: 100, D9: 100 };
    const p = projectSandbox(report, rigorMax);
    expect(p.rigorScore).toBe(100);
    expect(p.adoptionScore).toBe(40);
    expect(p.posture.id).toBe("manual"); // rigor high, adoption low
    expect(p.overall.overallScore).toBe(80); // 100*0.66 + 40*0.34, rounded
    expect(p.overall.level).toBe("L4");
    expect(p.overall.levelUp).toBe(true);
    expect(p.overall.deltaScore).toBe(40);
  });

  it("clamps and rounds override values into the stored dimension scores", () => {
    const report = consistent({});
    const p = projectSandbox(report, { D2: 150, D3: -20, D5: 33.4 });
    const byId = new Map(p.dimensions.map((d) => [d.id, d.score]));
    expect(byId.get("D2")).toBe(100);
    expect(byId.get("D3")).toBe(0);
    expect(byId.get("D5")).toBe(33);
  });
});
