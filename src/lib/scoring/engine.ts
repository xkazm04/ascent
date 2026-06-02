// Scoring engine: blends deterministic signal scores with the LLM assessment
// (guardbanded so the LLM can nuance but not contradict the evidence), applies the
// archetype weighting lens, rolls up to an overall score + maturity level, and computes
// the two-axis posture (Adoption × Rigor).

import type {
  DimensionId,
  DimensionResult,
  DimensionSignals,
  LevelPath,
  LevelPathStep,
  LlmAssessment,
  RepoArchetype,
  RepoSnapshot,
  ScanReport,
  ScoreProjection,
} from "@/lib/types";
import type { LLMProvider } from "@/lib/llm/provider";
import type { ComparableScan } from "@/lib/db/scans";
import {
  DIMENSION_BY_ID,
  LEVELS,
  LLM_GUARDBAND,
  SCORE_BLEND,
  axisScore,
  clamp,
  levelForScore,
  postureFor,
  weightsFor,
} from "@/lib/maturity/model";
import { buildFallbackRoadmap } from "@/lib/scoring/recommendations";
import { diffScans, type ScanDiff } from "@/lib/report/compare";
import { computeContributors, detectAiUsage } from "@/lib/analyze";

function evidenceStrings(s: DimensionSignals): string[] {
  return s.signals.map((x) => (x.detail ? `${x.label} (${x.detail})` : x.label));
}

export function assembleReport(
  snap: RepoSnapshot,
  signals: DimensionSignals[],
  assessment: LlmAssessment,
  engine: Pick<LLMProvider, "name" | "model">,
  scannedAt: string,
  archetype: RepoArchetype,
): ScanReport {
  const llmById = new Map(assessment.dimensions.map((d) => [d.id, d]));
  const lensW = weightsFor(archetype);
  const warnings: string[] = [];

  const dimensions: DimensionResult[] = signals.flatMap((s) => {
    const def = DIMENSION_BY_ID[s.id];
    // Guard against signal ids with no rubric definition (a persisted scan, a duplicated
    // entry, or a new detector lacking a matching def). Skip + warn rather than crash the
    // whole report on `def.name` / `def.weight`.
    if (!def) {
      const msg = `Unknown dimension id "${s.id}" was skipped during scoring (no rubric definition).`;
      warnings.push(msg);
      console.warn(`[engine] ${msg}`);
      return [];
    }
    const llm = llmById.get(s.id);
    const llmScore = llm ? clamp(llm.score) : s.signalScore;

    // Guardband the LLM score to within ±LLM_GUARDBAND of the deterministic score.
    const guarded = clamp(
      Math.max(s.signalScore - LLM_GUARDBAND, Math.min(s.signalScore + LLM_GUARDBAND, llmScore)),
    );
    const score = Math.round(SCORE_BLEND * guarded + (1 - SCORE_BLEND) * s.signalScore);

    return [{
      id: s.id,
      name: def.name,
      weight: lensW[s.id] ?? def.weight, // lens-adjusted weight (shown in UI)
      score,
      signalScore: s.signalScore,
      llmScore,
      summary: llm?.summary || `${def.name}: scored ${s.signalScore}/100 from repository signals.`,
      evidence: evidenceStrings(s),
      strengths: llm?.strengths ?? [],
      gaps: llm?.gaps ?? [],
    }];
  });

  // Reconcile the two independent sources of truth. The deterministic signal set is what we
  // actually scored and asked the LLM about; we only iterate `signals` above, so any LLM
  // dimension whose id is NOT in that set is silently dropped at blend time while still having
  // passed validation. Surface that drift as a warning instead of hiding it.
  const signalIds = new Set(signals.map((s) => s.id));
  for (const id of llmById.keys()) {
    if (!signalIds.has(id)) {
      const msg = `LLM scored dimension "${id}" that was not in the deterministic signal set — ignored.`;
      warnings.push(msg);
      console.warn(`[engine] ${msg}`);
    }
  }

  const scoreById = new Map(dimensions.map((d) => [d.id, d.score]));
  // Renormalize by the weights actually present: a weighted *mean*, not a raw weighted sum.
  // If any dimension is dropped (detector recovery, partial/persisted signals) or the lens
  // weights don't sum to exactly 1, the headline stays a true 0..100 score instead of
  // silently deflating and mis-leveling the repo.
  const presentWsum = dimensions.reduce((acc, d) => acc + (lensW[d.id] ?? 0), 0);
  const overallScore = clamp(
    presentWsum > 0
      ? Math.round(dimensions.reduce((acc, d) => acc + d.score * (lensW[d.id] ?? 0), 0) / presentWsum)
      : 0,
  );
  const level = levelForScore(overallScore);

  // Axis roll-ups: weighted mean of each axis's dimensions (lens weights renormalized).
  const scoreFor = (id: DimensionId) => scoreById.get(id) ?? 0;
  const adoptionScore = axisScore("adoption", scoreFor, archetype);
  const rigorScore = axisScore("rigor", scoreFor, archetype);

  const roadmap = assessment.roadmap.length
    ? assessment.roadmap
    : buildFallbackRoadmap(signals, overallScore, archetype);

  return {
    repo: snap.meta,
    overallScore,
    level,
    archetype,
    adoptionScore,
    rigorScore,
    posture: postureFor(adoptionScore, rigorScore),
    aiUsage: detectAiUsage(snap),
    contributors: computeContributors(snap),
    dimensions,
    headline:
      assessment.headline ||
      `${snap.meta.owner}/${snap.meta.name} is at ${level.id} — ${level.name}.`,
    strengths: assessment.strengths,
    risks: assessment.risks,
    roadmap,
    discrepancies: assessment.discrepancies ?? [],
    confidence: snap.coverage,
    warnings: warnings.length ? warnings : undefined,
    scannedAt,
    engine: { provider: engine.name, model: engine.model },
  };
}

// ---------------------------------------------------------------------------
// Score simulator — "what-if" projections over the same archetype-weighted blend.
// ---------------------------------------------------------------------------

/**
 * Re-run the overall blend with hypothetical per-dimension score overrides, returning the new
 * overall score + level (and the transition vs. today). Uses the report's already lens-adjusted
 * dimension weights and the same renormalized weighted-mean as assembleReport, so a projection
 * is consistent with how the headline score was actually computed.
 */
export function projectScore(
  report: ScanReport,
  overrides: Partial<Record<DimensionId, number>>,
): ScoreProjection {
  const dims = report.dimensions;
  const wsum = dims.reduce((acc, d) => acc + d.weight, 0);
  const overall = clamp(
    wsum > 0
      ? Math.round(
          dims.reduce((acc, d) => acc + (overrides[d.id] ?? d.score) * d.weight, 0) / wsum,
        )
      : 0,
  );
  const lvl = levelForScore(overall);
  const fromIdx = LEVELS.findIndex((l) => l.id === report.level.id);
  const toIdx = LEVELS.findIndex((l) => l.id === lvl.id);
  return {
    overallScore: overall,
    level: lvl.id,
    levelName: lvl.name,
    deltaScore: overall - report.overallScore,
    fromLevel: report.level.id,
    levelUp: toIdx > fromIdx,
  };
}

/** Project the upside of fully closing one dimension's gap (raising it to 100). */
export function projectDimensionClose(report: ScanReport, dim: DimensionId): ScoreProjection {
  const cur = report.dimensions.find((d) => d.id === dim)?.score ?? 0;
  return projectScore(report, { [dim]: Math.max(cur, 100) });
}

/**
 * The fewest, highest-leverage gaps to close to reach the next maturity band — a concrete,
 * motivating "how do I level up" path rather than a static grade. Greedily closes the
 * dimensions with the most weighted upside first (each contributes the most overall points per
 * dimension changed) and stops as soon as the projection crosses the next band floor.
 */
export function cheapestPathToNextLevel(report: ScanReport): LevelPath {
  const fromIdx = LEVELS.findIndex((l) => l.id === report.level.id);
  const nextLevel = fromIdx >= 0 && fromIdx < LEVELS.length - 1 ? LEVELS[fromIdx + 1] : null;
  if (!nextLevel) {
    return { reachable: true, target: null, steps: [], projected: projectScore(report, {}) };
  }
  const targetScore = nextLevel.band[0];

  const candidates = report.dimensions
    .filter((d) => d.score < 100)
    .map((d) => ({ dim: d.id, upside: d.weight * (100 - d.score) }))
    .sort((a, b) => b.upside - a.upside);

  const overrides: Partial<Record<DimensionId, number>> = {};
  const steps: LevelPathStep[] = [];
  for (const c of candidates) {
    const before = projectScore(report, overrides).overallScore;
    overrides[c.dim] = 100;
    const after = projectScore(report, overrides).overallScore;
    steps.push({ dimension: c.dim, targetScore: 100, gain: after - before });
    if (after >= targetScore) break;
  }

  const projected = projectScore(report, overrides);
  return {
    reachable: projected.overallScore >= targetScore,
    target: { level: nextLevel.id, name: nextLevel.name, score: targetScore },
    steps,
    projected,
  };
}

// ---------------------------------------------------------------------------
// Score delta engine — explain movement between two scans.
// ---------------------------------------------------------------------------

/** Adapt a full ScanReport into the comparable shape the pure diff consumes. A live report
 *  carries no recommendation statuses (those are tracked only once persisted), so the
 *  rec-status side of the diff is left empty — score, level, posture, gap, and signal
 *  movement are all derived from the report itself. */
function reportToComparable(report: ScanReport): ComparableScan {
  return {
    id: report.repo.headSha ?? report.scannedAt,
    scannedAt: report.scannedAt,
    overallScore: report.overallScore,
    level: report.level.id,
    levelName: report.level.name,
    archetype: report.archetype,
    adoptionScore: report.adoptionScore,
    rigorScore: report.rigorScore,
    posture: report.posture.id,
    confidence: report.confidence,
    engineProvider: report.engine.provider,
    headSha: report.repo.headSha ?? null,
    dimensions: report.dimensions.map((d) => ({
      dimId: d.id,
      name: d.name,
      score: d.score,
      signalScore: d.signalScore,
      evidence: d.evidence,
      gaps: d.gaps,
    })),
    recommendations: [],
  };
}

/**
 * Diff two full scan reports into an explained-movement summary: per-dimension and overall
 * score deltas, level/posture transitions, and — the point of it — which concrete detector
 * signals appeared or disappeared, with a one-line attribution per moved dimension (e.g.
 * "D2 +12: Found 18 test files; Coverage tracking configured"). `prev` is the baseline and
 * `curr` the scan being evaluated; every delta reads as `curr − prev`.
 *
 * This is the report-level front door over the shared pure diff (see lib/report/compare.ts),
 * for diffing in-memory reports — e.g. a fresh scan against the previously persisted one, to
 * turn a regression into an actionable, evidence-backed alert rather than just a trend line.
 */
export function diffReports(prev: ScanReport, curr: ScanReport): ScanDiff {
  return diffScans(reportToComparable(prev), reportToComparable(curr));
}
