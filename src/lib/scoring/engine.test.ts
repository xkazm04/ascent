import { describe, it, expect } from "vitest";
import { diffReports } from "./engine";
import { DIMENSIONS, LEVEL_BY_ID, postureFor } from "@/lib/maturity/model";
import type { DimensionResult, ScanReport } from "@/lib/types";

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
