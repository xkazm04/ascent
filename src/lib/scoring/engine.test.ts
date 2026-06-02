import { describe, it, expect } from "vitest";
import { assembleReport, diffReports } from "./engine";
import { DIMENSIONS, LEVEL_BY_ID, levelForScore, overallScoreFor, postureFor } from "@/lib/maturity/model";
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
