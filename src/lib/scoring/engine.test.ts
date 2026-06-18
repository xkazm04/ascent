import { describe, it, expect } from "vitest";
import { assembleReport, contributions, diffReports, projectDimensionClose, projectSandbox, projectedGain } from "./engine";
import { DIMENSIONS, LEVEL_BY_ID, LLM_GUARDBAND, SCORE_BLEND, axisScore, levelForScore, overallScoreFor, postureFor } from "@/lib/maturity/model";
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

  describe("projectedGain — persisted-scan ROI for the backlog", () => {
    /** Persisted-row shape: just {id, score} pairs, the way getOrgBacklog reads them. */
    const rows = (report: ScanReport) => report.dimensions.map((d) => ({ id: d.id, score: d.score }));

    it("matches projectDimensionClose on a self-consistent assembled report", () => {
      const report = consistent({ D2: 20, D5: 35 });
      for (const d of DIMENSIONS) {
        const viaReport = projectDimensionClose(report, d.id);
        const viaRows = projectedGain(rows(report), report.archetype, d.id);
        expect(viaRows.points).toBe(Math.max(0, viaReport.deltaScore));
        expect(viaRows.unlocks).toBe(viaReport.levelUp ? viaReport.level : null);
      }
    });

    it("an already-100 dimension projects a 0-point gain and no unlock", () => {
      const report = consistent({ D2: 100 });
      expect(projectedGain(rows(report), "org", "D2")).toEqual({ points: 0, unlocks: null });
    });

    it("an unknown / absent dimension id projects 0, never a fake gain", () => {
      const report = consistent({});
      expect(projectedGain(rows(report), "org", "D99")).toEqual({ points: 0, unlocks: null });
    });

    it("reports the level the projection crosses into", () => {
      // Everything at 40 (overall 40, L2); fully closing a heavyweight dim should cross 45 (L3).
      const all40 = Object.fromEntries(DIMENSIONS.map((d) => [d.id, 40]));
      const report = consistent(all40);
      const gain = projectedGain(rows(report), "org", "D1");
      expect(gain.points).toBeGreaterThan(0);
      expect(gain.unlocks).toBe("L3");
    });

    it("an unknown archetype falls back to the org lens instead of throwing", () => {
      const report = consistent({ D2: 10 });
      const viaOrg = projectedGain(rows(report), "org", "D2");
      expect(projectedGain(rows(report), "not-a-lens", "D2")).toEqual(viaOrg);
    });
  });
});

// ---------------------------------------------------------------------------
// assembleReport — coverage-weighted blend + LLM guardband (critical #1)
//
// blankSnap() (above) hardcodes coverage:1 and uses no diverging LLM scores, so the
// blend arithmetic, the non-finite-coverage guard, and the ±LLM_GUARDBAND clamp never
// actually execute. These tests drive assembleReport with coverage ≠ 1 and an out-of-band
// LLM score so a refactor of the load-bearing blend math can't pass silently.
// ---------------------------------------------------------------------------

/** A snapshot with an explicit coverage value (number, NaN, or Infinity are all valid here). */
function snapWithCoverage(coverage: number): RepoSnapshot {
  return {
    meta: { owner: "acme", name: "widget", url: "", stars: 0, forks: 0, defaultBranch: "main" },
    tree: [],
    files: [],
    commits: [],
    truncated: false,
    coverage,
  };
}

/** Deterministic signals with explicit per-dimension signalScore (+ optional failed flag). */
function signalsWith(
  spec: Record<string, { signalScore: number; failed?: boolean }>,
): DimensionSignals[] {
  return Object.entries(spec).map(([id, s]) => ({
    id: id as DimensionSignals["id"],
    signalScore: s.signalScore,
    signals: [{ label: `${id} signal` }],
    ...(s.failed ? { failed: true } : {}),
  }));
}

/** An LlmAssessment carrying explicit per-dimension scores (the divergence the guardband governs). */
function assessmentWith(scores: Record<string, number>): LlmAssessment {
  return {
    dimensions: Object.entries(scores).map(([id, score]) => ({
      id: id as DimensionSignals["id"],
      score,
      summary: "",
      strengths: [],
      gaps: [],
    })),
    headline: "",
    strengths: [],
    risks: [],
    roadmap: [],
    discrepancies: [],
  };
}

const eng = { name: "gemini", model: "x" };
const AT = "2026-01-01T00:00:00Z";
const scoreOf = (r: ScanReport, id: string) => r.dimensions.find((d) => d.id === id)!.score;

describe("assembleReport — coverage-weighted blend + LLM guardband (#1)", () => {
  it("pins SCORE_BLEND and LLM_GUARDBAND so the arithmetic below is self-documenting", () => {
    // These tests hard-code the rounded results derived from these two constants. If the rubric
    // changes them, this assertion fails first and explains why the numeric expectations moved.
    expect(SCORE_BLEND).toBe(0.6);
    expect(LLM_GUARDBAND).toBe(25);
  });

  it("at coverage:1 blends exactly round(0.6·llm + 0.4·signal) for an in-band LLM score", () => {
    // signal 40, llm 55 (within ±25) → guarded 55 → round(0.6·55 + 0.4·40) = round(49) = 49.
    const report = assembleReport(
      snapWithCoverage(1),
      signalsWith({ D1: { signalScore: 40 } }),
      assessmentWith({ D1: 55 }),
      eng,
      AT,
      "org",
    );
    expect(scoreOf(report, "D1")).toBe(49);
    expect(report.dimensions[0]!.llmScore).toBe(55);
    expect(report.dimensions[0]!.signalScore).toBe(40);
  });

  it("at coverage:0.5 halves the blend so the score leans harder on the signal (strictly between)", () => {
    // effectiveBlend = 0.6·0.5 = 0.3 → round(0.3·55 + 0.7·40) = round(44.5) = 45.
    // 45 sits strictly between the full-blend result (49) and the pure signal floor (40).
    const half = assembleReport(
      snapWithCoverage(0.5),
      signalsWith({ D1: { signalScore: 40 } }),
      assessmentWith({ D1: 55 }),
      eng,
      AT,
      "org",
    );
    expect(scoreOf(half, "D1")).toBe(45);
    expect(scoreOf(half, "D1")).toBeGreaterThan(40); // > pure signal floor
    expect(scoreOf(half, "D1")).toBeLessThan(49); // < full-coverage blend
  });

  it("at coverage:0 the blend vanishes and the score is the pure deterministic signal", () => {
    // effectiveBlend = 0 → round(0·llm + 1·signal) = signal, regardless of the LLM score.
    const report = assembleReport(
      snapWithCoverage(0),
      signalsWith({ D1: { signalScore: 40 } }),
      assessmentWith({ D1: 100 }),
      eng,
      AT,
      "org",
    );
    expect(scoreOf(report, "D1")).toBe(40);
  });

  it("clamps coverage above 1 down to the full-blend path (never over-weights the LLM)", () => {
    // clamp(coverage,0,1) caps effectiveBlend at SCORE_BLEND, so coverage:2 == coverage:1.
    const over = assembleReport(snapWithCoverage(2), signalsWith({ D1: { signalScore: 40 } }), assessmentWith({ D1: 55 }), eng, AT, "org");
    const full = assembleReport(snapWithCoverage(1), signalsWith({ D1: { signalScore: 40 } }), assessmentWith({ D1: 55 }), eng, AT, "org");
    expect(scoreOf(over, "D1")).toBe(scoreOf(full, "D1"));
    expect(scoreOf(over, "D1")).toBe(49);
  });

  for (const bad of [NaN, Infinity, -Infinity] as const) {
    it(`treats non-finite coverage (${bad}) as full coverage — identical report, never NaN`, () => {
      // The finite-guard invariant: a broken estimate must default to 1 (the calibrated SCORE_BLEND
      // path), not propagate through clamp's Math.max/min and poison every blended score → NaN.
      const guarded = assembleReport(snapWithCoverage(bad), signalsWith({ D1: { signalScore: 40 }, D2: { signalScore: 70 } }), assessmentWith({ D1: 55, D2: 70 }), eng, AT, "org");
      const full = assembleReport(snapWithCoverage(1), signalsWith({ D1: { signalScore: 40 }, D2: { signalScore: 70 } }), assessmentWith({ D1: 55, D2: 70 }), eng, AT, "org");
      expect(scoreOf(guarded, "D1")).toBe(scoreOf(full, "D1"));
      expect(scoreOf(guarded, "D2")).toBe(scoreOf(full, "D2"));
      expect(Number.isFinite(guarded.overallScore)).toBe(true);
      expect(Number.isNaN(guarded.overallScore)).toBe(false);
      // confidence echoes the raw snapshot coverage; the GUARD only protects the blend math.
      expect(Number.isFinite(guarded.confidence as number)).toBe(false);
    });
  }

  it("clamps an LLM score beyond +LLM_GUARDBAND to signalScore+25 before blending", () => {
    // signal 40, llm 100 → guarded = min(40+25, 100) = 65 → round(0.6·65 + 0.4·40) = round(55) = 55.
    // Without the guardband it would be round(0.6·100 + 0.4·40) = 76 — a 21-pt hallucinated inflation.
    const report = assembleReport(snapWithCoverage(1), signalsWith({ D1: { signalScore: 40 } }), assessmentWith({ D1: 100 }), eng, AT, "org");
    expect(scoreOf(report, "D1")).toBe(55);
    // The stored llmScore is the raw (clamped-to-0..100) LLM value, NOT the guardbanded one.
    expect(report.dimensions[0]!.llmScore).toBe(100);
  });

  it("clamps an LLM score below -LLM_GUARDBAND up to signalScore-25 before blending", () => {
    // signal 80, llm 0 → guarded = max(80-25, 0) = 55 → round(0.6·55 + 0.4·80) = round(65) = 65.
    const report = assembleReport(snapWithCoverage(1), signalsWith({ D1: { signalScore: 80 } }), assessmentWith({ D1: 0 }), eng, AT, "org");
    expect(scoreOf(report, "D1")).toBe(65);
  });

  it("leaves an in-band LLM score untouched by the guardband (exactly ±25 is the boundary)", () => {
    // signal 50, llm 75 is exactly at the +25 boundary → guarded = 75 → round(0.6·75 + 0.4·50) = round(65) = 65.
    const report = assembleReport(snapWithCoverage(1), signalsWith({ D1: { signalScore: 50 } }), assessmentWith({ D1: 75 }), eng, AT, "org");
    expect(scoreOf(report, "D1")).toBe(65);
  });

  it("falls back to the signal score (no blend) for a dimension the LLM never scored", () => {
    // No LLM dim for D2 → llmScore defaults to the signal, guarded == signal, so the blend is a no-op.
    const report = assembleReport(snapWithCoverage(1), signalsWith({ D1: { signalScore: 60 }, D2: { signalScore: 30 } }), assessmentWith({ D1: 60 }), eng, AT, "org");
    expect(scoreOf(report, "D2")).toBe(30);
    // And the partial-AI-coverage honesty warning names the un-assessed dimension.
    expect((report.warnings ?? []).some((w) => /D2/.test(w) && /not fully AI-validated/i.test(w))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assembleReport — failed-detector exclusion + all-failed INCOMPLETE honesty (critical #2)
//
// A detector that THREW emits a placeholder signalScore:0. It must be DROPPED (so
// overallScoreFor renormalizes over the present dims), never folded as a genuine 0 that
// deflates the repo for our own extraction failure. When EVERY detector fails the report
// must read as INCOMPLETE, not as a confident L1 (Manual) verdict.
// ---------------------------------------------------------------------------

describe("assembleReport — failed detector excluded from the overall (#2)", () => {
  it("excludes a failed dimension from blend + roll-up, renormalizing over the present dims", () => {
    // D2 threw (failed, placeholder signalScore:0); the other 8 dims score 90 (LLM matches → guarded 90).
    const spec: Record<string, { signalScore: number; failed?: boolean }> = {};
    const llm: Record<string, number> = {};
    for (const d of DIMENSIONS) {
      if (d.id === "D2") {
        spec[d.id] = { signalScore: 0, failed: true };
      } else {
        spec[d.id] = { signalScore: 90 };
        llm[d.id] = 90;
      }
    }
    const report = assembleReport(snapWithCoverage(1), signalsWith(spec), assessmentWith(llm), eng, AT, "org");

    // The failed dim is not present in the report's dimension list at all.
    expect(report.dimensions.some((d) => d.id === "D2")).toBe(false);
    expect(report.dimensions).toHaveLength(8);

    // Overall is the renormalized mean over the 8 PRESENT dims (all 90), NOT the 9-way mean that
    // would fold the fake 0 (which would deflate it to ~77 and could drop a whole level).
    const present = report.dimensions.map((d) => ({ id: d.id, score: d.score }));
    expect(report.overallScore).toBe(overallScoreFor(present, "org"));
    expect(report.overallScore).toBe(90); // all present dims are 90 → renormalized mean 90
    expect(report.level.id).toBe("L5");

    // Proof the fake-0 fold would have been materially worse (different level).
    const naiveWithZero = overallScoreFor(
      [...present, { id: "D2" as const, score: 0 }],
      "org",
    );
    expect(naiveWithZero).toBeLessThan(report.overallScore);
    expect(levelForScore(naiveWithZero).id).not.toBe(report.level.id);

    // And a warning names the un-measured dimension as excluded (the honesty signal the UI shows).
    expect(
      (report.warnings ?? []).some((w) => /D2/.test(w) && /(not measured|excluded)/i.test(w)),
    ).toBe(true);
  });

  it("all detectors failed → empty dimensions, INCOMPLETE warning, not a genuine L1", () => {
    const spec: Record<string, { signalScore: number; failed?: boolean }> = {};
    for (const d of DIMENSIONS) spec[d.id] = { signalScore: 0, failed: true };
    const report = assembleReport(snapWithCoverage(1), signalsWith(spec), assessmentWith({}), eng, AT, "org");

    expect(report.dimensions).toHaveLength(0);
    // overallScoreFor over no dims is 0 → the renormalized floor levels at L1...
    expect(report.overallScore).toBe(0);
    expect(report.level.id).toBe("L1");
    // ...but the honesty invariant the UI depends on is the loud INCOMPLETE warning that says this
    // is NOT a genuine L1 result — assert that distinguishing text, not just the (misleading) level.
    const warnings = report.warnings ?? [];
    expect(warnings.some((w) => /INCOMPLETE scan/i.test(w))).toBe(true);
    expect(warnings.some((w) => /not a genuine L1/i.test(w))).toBe(true);
  });

  it("the failed-exclusion warning does not fire on a fully healthy scan", () => {
    const spec: Record<string, { signalScore: number; failed?: boolean }> = {};
    const llm: Record<string, number> = {};
    for (const d of DIMENSIONS) {
      spec[d.id] = { signalScore: 50 };
      llm[d.id] = 50;
    }
    const report = assembleReport(snapWithCoverage(1), signalsWith(spec), assessmentWith(llm), eng, AT, "org");
    expect(report.dimensions).toHaveLength(9);
    expect((report.warnings ?? []).some((w) => /(not measured|INCOMPLETE)/i.test(w))).toBe(false);
  });
});
