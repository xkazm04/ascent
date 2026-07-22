// Scoring engine: blends deterministic signal scores with the LLM assessment
// (guardbanded so the LLM can nuance but not contradict the evidence), applies the
// archetype weighting lens, rolls up to an overall score + maturity level, and computes
// the two-axis posture (Adoption × Rigor).

import type {
  ContributionBreakdown,
  DimensionContribution,
  DimensionId,
  DimensionResult,
  DimensionSignals,
  Discrepancy,
  LevelId,
  LevelPath,
  LevelPathStep,
  LlmAssessment,
  RepoArchetype,
  RepoSnapshot,
  SandboxProjection,
  ScanReport,
  ScoreProjection,
} from "@/lib/types";
import type { LLMProvider } from "@/lib/llm/provider";
import type { ComparableScan } from "@/lib/db/scans";
import {
  DIMENSION_BY_ID,
  LLM_GUARDBAND,
  SCORE_BLEND,
  axisScore,
  axisMeasured,
  clamp,
  levelForScore,
  levelIndex,
  nextLevel as nextLevelOf,
  overallScoreFor,
  postureFor,
  weightsFor,
} from "@/lib/maturity/model";
import { buildFallbackRoadmap } from "@/lib/scoring/recommendations";
import { diffScans, type ScanDiff } from "@/lib/report/compare";
import { computeContributors, detectAiUsage } from "@/lib/analyze";
import { formatSignal } from "@/lib/types";

function evidenceStrings(s: DimensionSignals): string[] {
  return s.signals.map(formatSignal);
}

// D9 (Supply Chain & Security) is the ONE fully-deterministic dimension: its score is the security
// check battery's risk-weighted mean and the LLM only narrates it (never moves the number), so it is
// excluded from the P1-1 guardband-widening loop below. That left it with no correction path for the
// documented "config-as-code only" ceiling (docs/CALIBRATION.md): GitHub "default-setup" CodeQL is
// configured in repo settings and leaves NO workflow file, and an org-level SECURITY.md / dependabot
// policy lives in the org's `.github` repo — both real, both invisible to a read-only file scan, so the
// affected sub-checks score a false 0 and floor D9 with no escape (pallets/flask, vercel/next.js hit
// exactly this).
//
// Escape hatch, per the "n/a, not 0" philosophy: when the model — acting as auditor — flags a
// HIGH-CONFIDENCE, D9-targeted VISIBILITY blind spot (it asserts the security control exists but runs
// where the file scan can't see it), treat D9's deterministic signal as UNMEASURABLE: exclude it and let
// the overall/axis renormalize over the dimensions we could actually measure, rather than counting a
// visibility 0 as a genuine security absence. The model can only mark D9 unmeasurable this way; it can
// NEVER raise a measured D9 sub-check score (D9 is dropped, not blended up). Matching is deliberately
// conservative — the discrepancy must be for D9 AND name a concrete invisibility mechanism (default-setup
// scanning, an org-level/`.github`-repo policy, controls configured off-repo/in settings). A generic "D9
// looks low" never qualifies, so this can't become a backdoor for the LLM to hand-wave the number up.
const D9_VISIBILITY_BLIND_SPOT =
  /\b(default[-\s]?setup|default (?:code[-\s]?)?scanning|org(?:anization)?[-\s]?(?:level|wide)|\.github (?:repo|repository)|repo(?:sitory)? settings|configured (?:in|via|at) (?:the )?(?:repo|repository|org|organization|settings|github)|off[-\s]?repo|off[-\s]?github|outside the (?:repo|repository|tree)|not committed to the (?:repo|repository|tree)|invisible to (?:a |the )?(?:file|read-only)|github[-\s]?native (?:security|scanning|codeql))\b/i;

function hasD9VisibilityBlindSpot(discrepancies: Discrepancy[]): boolean {
  return discrepancies.some(
    (d) => d.dimension === "D9" && D9_VISIBILITY_BLIND_SPOT.test(d.claim),
  );
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
  // Dimensions the LLM's self-audit flagged as a detector discrepancy — a MISSED signal (a visibility
  // blind spot that scored a false 0, e.g. CI/review running off-GitHub) OR a FALSE POSITIVE that
  // over-credited (e.g. "mypy" on a Rust repo). For these the deterministic signal is suspect, so the
  // guardband is WIDENED below so the model's judgment (in either direction) isn't pinned to the broken
  // signal — closing the loop where the model correctly diagnosed the problem in prose but couldn't move
  // the number (reference-scan P1-1). D9 stays fully deterministic (its blind spots are fixed upstream).
  const flaggedDims = new Set((assessment.discrepancies ?? []).map((d) => d.dimension));
  // D9 visibility escape hatch (see the note above hasD9VisibilityBlindSpot): a high-confidence,
  // D9-targeted "the security is real but the file scan can't see it" discrepancy makes D9's
  // deterministic signal UNMEASURABLE, so it is dropped + renormalized rather than counted as a
  // measured 0. Kept separate from flaggedDims because D9 never enters the guardband-widening blend.
  const d9Unmeasurable = hasD9VisibilityBlindSpot(assessment.discrepancies ?? []);
  const lensW = weightsFor(archetype);
  const warnings: string[] = [];
  // Track which deterministic dimensions the LLM did NOT score: a missing dim falls back to its
  // signal floor below (fine numerically) but the report must not then read as fully AI-validated
  // — see the partial-coverage warning after the blend.
  const llmMissing: DimensionId[] = [];

  // Confidence-weighted blend: scale the LLM's pull by how much of the repo we actually inspected.
  // `coverage` (0..1) was computed and surfaced as report.confidence but never touched the math, so a
  // half-seen, rate-limited, or truncated repo blended the LLM with the same weight as a full scan —
  // false precision. Now a low-coverage scan leans HARDER on the deterministic signals (which are
  // coverage-robust). At full coverage this is exactly SCORE_BLEND, so the calibrated full-scan path
  // is unchanged.
  // Guard the trust boundary: a non-finite coverage (NaN/Infinity from a broken estimate) would pass
  // straight through clamp (Math.max/min PROPAGATE NaN) and poison effectiveBlend — every blended
  // dimension score, the overall, axes, level, and posture would silently collapse to NaN with no
  // warning. Default a non-finite coverage to full (1) — the calibrated SCORE_BLEND path.
  const coverage = Number.isFinite(snap.coverage) ? snap.coverage : 1;
  const effectiveBlend = SCORE_BLEND * clamp(coverage, 0, 1);

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
    // A detector that THREW emits a placeholder signalScore:0 (not a real measurement). Folding that
    // 0 into the weighted mean would deflate the overall as if the repo genuinely scored 0 on this
    // dimension. Drop it like a missing/dropped dim (overallScoreFor renormalizes over present dims)
    // and warn, rather than penalize the repo for our own extraction failure.
    if (s.failed) {
      const msg = `Dimension "${s.id}" was not measured (detector error) and is excluded from the score.`;
      warnings.push(msg);
      console.warn(`[engine] ${msg}`);
      return [];
    }
    // D9 visibility escape hatch: the model flagged (high-confidence) that this repo's security runs
    // through channels a file scan can't see (e.g. GitHub default-setup CodeQL configured in repo
    // settings, or an org-level SECURITY.md/dependabot policy in the org's `.github` repo). D9's
    // deterministic 0 is then a blind spot, not a measured absence — treat it as UNMEASURABLE (n/a):
    // exclude it so the overall + rigor axis renormalize over the dimensions we could measure, instead
    // of flooring the repo on a control it genuinely has. The LLM only marks it unmeasurable here; it
    // never raises the D9 number.
    if (s.id === "D9" && d9Unmeasurable) {
      const msg =
        `Security (D9) was treated as UNMEASURABLE and excluded from the score: the assessment flagged ` +
        `that this repository's security runs through channels a file scan cannot see (e.g. GitHub ` +
        `default-setup code scanning, or an org-level security policy), so its deterministic 0 reflects a ` +
        `visibility blind spot, not a measured absence. D9 is renormalized out (n/a) rather than counted ` +
        `as 0 — the security score is not fully validated for this repo.`;
      warnings.push(msg);
      console.warn(`[engine] ${msg}`);
      return [];
    }
    const llm = llmById.get(s.id);
    if (!llm) llmMissing.push(s.id);
    const llmScore = llm ? clamp(llm.score) : s.signalScore;

    // Deterministic dimensions (D9 — the security check battery) take their signal as the final score:
    // the LLM never moves the number, only narrates it. `llmScore` is still recorded for transparency.
    // Everything else blends: guardband the LLM to within ±LLM_GUARDBAND of the deterministic score,
    // then confidence-weight the two.
    // Widen the guardband for a dimension the LLM flagged as a detector discrepancy (P1-1): its signal
    // is suspect, so trust the model's judgment further (still bounded, so it nuances rather than
    // fabricates). A dimension the model didn't flag keeps the calibrated ±LLM_GUARDBAND.
    const band = flaggedDims.has(s.id) ? LLM_GUARDBAND * 2 : LLM_GUARDBAND;
    const guarded = clamp(
      Math.max(s.signalScore - band, Math.min(s.signalScore + band, llmScore)),
    );
    const score = s.deterministic
      ? s.signalScore
      : Math.round(effectiveBlend * guarded + (1 - effectiveBlend) * s.signalScore);

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
      // Deterministic dimensions carry their own remediation (the check battery's fixes); everything
      // else uses the LLM's gaps.
      gaps: s.gaps ?? llm?.gaps ?? [],
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

  // Partial LLM coverage: the usability gate (isAssessmentUsable) only requires HALF the dimensions
  // to be scored and never checks WHICH, so a model can score only the dims a repo is strong in and
  // omit the weak ones — which then fall back to their signal floor while the present dims blend up,
  // and nothing warns. Surface it so the headline can't read as fully AI-validated when it isn't.
  if (llmMissing.length > 0 && assessment.dimensions.length > 0) {
    // Count over the BLENDED dimensions, not raw signals.length: a dimension dropped earlier (failed
    // detector or no rubric def) never reaches the blend and is never added to llmMissing, so
    // `signals.length - llmMissing.length` would overstate coverage (e.g. "9 of 9" when one signal
    // failed and the LLM scored the other 8). `dimensions` is exactly the set that was scored.
    const scorable = dimensions.length;
    const assessed = scorable - llmMissing.length;
    warnings.push(
      `AI assessed ${assessed} of ${scorable} dimensions; ${llmMissing.join(", ")} reflect ` +
        `detected signals only (no AI nuance) — the overall is not fully AI-validated.`,
    );
  }

  // Total detector failure: when EVERY dimension was dropped (all detectors failed / returned no data),
  // `dimensions` is empty, overallScoreFor() returns 0, and the repo levels at L1 — indistinguishable
  // from a genuinely manual repo. Surface it loudly so the headline can't read as a real L1 result.
  if (dimensions.length === 0) {
    warnings.push(
      "No dimensions could be scored — every signal detector failed or returned no data. This is an " +
        "INCOMPLETE scan, not a genuine L1 (Manual) result; re-scan or check repository access.",
    );
  }

  const scoreById = new Map(dimensions.map((d) => [d.id, d.score]));
  // Renormalized, archetype-weighted mean (a weighted *mean*, not a raw weighted sum): if any
  // dimension is dropped (detector recovery, partial/persisted signals) or the lens weights don't
  // sum to exactly 1, the headline stays a true 0..100 score instead of silently deflating and
  // mis-leveling the repo. Shared with the mock provider so the keyless path levels identically.
  const overallScore = overallScoreFor(dimensions, archetype);
  const level = levelForScore(overallScore);

  // Axis roll-ups: weighted mean of each axis's dimensions (lens weights renormalized).
  // Bug-fix (maturity-model-scoring-engine #1): pass the SAME present-id predicate the overall path
  // uses (overallScoreFor iterates only `dimensions`). Without it, a dropped/failed dimension is
  // charged at 0 with full weight on the axis path only — deflating that axis and flipping the
  // posture quadrant — while the headline overall it sits next to is computed correctly. When all
  // dimensions are present this predicate always returns true, so a healthy full scan is unchanged.
  const present = new Set(dimensions.map((d) => d.id));
  const scoreFor = (id: DimensionId) => scoreById.get(id) ?? 0;
  const isPresent = (id: DimensionId) => present.has(id);
  const adoptionScore = axisScore("adoption", scoreFor, archetype, isPresent);
  const rigorScore = axisScore("rigor", scoreFor, archetype, isPresent);

  // A fully-unmeasured axis (every detector on it failed) scores a fabricated 0 from axisScore, which
  // postureFor would then read as a genuine "low on this axis" and SILENTLY place the repo in the wrong
  // quadrant (maturity-model-scoring-engine #7). We can't null the persisted axis number, so instead we
  // detect the unmeasured axis and surface it as a warning — excluding it from a posture the report would
  // otherwise present as confident. (When only ONE axis is measured the whole scan is already degraded;
  // the total-failure case is warned separately above.)
  const adoptionMeasured = axisMeasured("adoption", archetype, isPresent);
  const rigorMeasured = axisMeasured("rigor", archetype, isPresent);
  if (dimensions.length > 0 && (!adoptionMeasured || !rigorMeasured)) {
    const axisName = !adoptionMeasured ? "Adoption" : "Rigor";
    warnings.push(
      `The ${axisName} axis could not be measured — no dimension on it was scored, so its axis score is a ` +
        `placeholder 0, not a real reading. The posture quadrant is not reliable on that axis.`,
    );
  }

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
  // Single weighted-mean source of truth: reuse overallScoreFor (the exact function the headline
  // uses) over the possibly-overridden dimension scores. This re-implemented the mean before and
  // renormalized by Σ d.weight, where d.weight is `lensW[id] ?? def.weight` while overallScoreFor
  // uses `lensW[id] ?? 0` — for a lens-missing id the denominators diverged, so projectScore(report,
  // {}) no longer equaled report.overallScore (breaking the Sandbox baseline invariant and skewing
  // deltaScore / cheapestPathToNextLevel). One implementation, one weight source.
  const scored = report.dimensions.map((d) => ({ id: d.id, score: overrides[d.id] ?? d.score }));
  const overall = overallScoreFor(scored, report.archetype);
  const lvl = levelForScore(overall);
  // levelIndex clamps an unrecognized current-level id (rubric schema drift, a legacy or
  // hand-edited persisted scan) to L1 so an unknown level can't read as "above everything" and
  // falsely mark every projection a level-up. `toIdx` comes from levelForScore so it is always a
  // valid band (the clamp is a no-op there).
  const fromIdx = levelIndex(report.level.id);
  const toIdx = levelIndex(lvl.id);
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

export interface ProjectedGain {
  /** Overall-score points gained if this dimension's gap were fully closed (never negative). */
  points: number;
  /** The maturity level the projection crosses into, or null when it stays in band. */
  unlocks: LevelId | null;
}

/**
 * Persisted-scan sibling of {@link projectDimensionClose}: the engine-true ROI of fully closing
 * one dimension (raising it to 100), computed straight from a scan's stored dimension rows +
 * archetype — no assembled ScanReport needed, so the org backlog and the recommendations API can
 * stamp "+N pts · unlocks LX" on every item instead of fuzzy impact/effort words. Reuses the exact
 * headline math (overallScoreFor + levelForScore), display-only — it never feeds back into scoring.
 * Defensive against persisted drift: an unknown dim id carries zero lens weight, an unknown
 * archetype falls back to the org lens, and an absent target dimension projects a 0-point gain.
 */
export function projectedGain(
  dims: { id: string; score: number }[],
  archetype: string,
  dimId: string,
): ProjectedGain {
  const scored = dims.map((d) => ({ id: d.id as DimensionId, score: d.score }));
  const lens = archetype as RepoArchetype; // weightsFor falls back to the org lens for unknowns
  const current = overallScoreFor(scored, lens);
  const raised = scored.map((d) => (d.id === dimId ? { ...d, score: 100 } : d));
  const projected = overallScoreFor(raised, lens);
  // Same clamp as projectScore (via levelIndex): an unrecognized current band must not read as
  // "above everything".
  const fromIdx = levelIndex(levelForScore(current).id);
  const to = levelForScore(projected);
  const toIdx = levelIndex(to.id);
  return { points: Math.max(0, projected - current), unlocks: toIdx > fromIdx ? to.id : null };
}

/**
 * Full what-if recompute for the interactive Roadmap Sandbox: apply hypothetical per-dimension
 * score overrides and re-derive everything the report's hero shows — overall score + level
 * transition, both axis roll-ups, and the resulting posture quadrant. Overrides are clamped to
 * 0..100 and rounded so the projected dimension scores match what the engine would have stored,
 * and the same clamped values feed every roll-up (overall, axes), keeping them in lockstep.
 *
 * With an empty override set this returns the report's own numbers byte-for-byte (overall,
 * adoption, rigor, posture), because it reuses overallScoreFor/axisScore/postureFor — the exact
 * functions assembleReport used. Pure and dependency-light, so the client can re-run it live on
 * every slider tick with no server round-trip.
 */
export function projectSandbox(
  report: ScanReport,
  overrides: Partial<Record<DimensionId, number>>,
): SandboxProjection {
  const clamped: Partial<Record<DimensionId, number>> = {};
  for (const [id, v] of Object.entries(overrides)) {
    if (v != null) clamped[id as DimensionId] = clamp(Math.round(v));
  }
  const dimensions = report.dimensions.map((d) =>
    clamped[d.id] !== undefined ? { ...d, score: clamped[d.id]! } : d,
  );
  const scoreById = new Map(dimensions.map((d) => [d.id, d.score]));
  const scoreFor = (id: DimensionId) => scoreById.get(id) ?? 0;
  // Bug-fix (maturity-model-scoring-engine #1): pass the SAME present-id predicate assembleReport uses
  // (overallScoreFor / axisScore renormalize over present dims only). Without it, a partial report — a
  // dropped/failed detector leaves <9 dimensions — charged the absent dimension 0 at full weight on
  // these axis paths only, deflating adoption/rigor and potentially flipping the posture quadrant, so
  // the Sandbox baseline silently disagreed with the report header (projectScore/overall stayed correct
  // because it routes through overallScoreFor). With every dimension present the predicate is always
  // true, so a full report reproduces the report's own numbers exactly — the documented invariant.
  const present = new Set(dimensions.map((d) => d.id));
  const adoptionScore = axisScore("adoption", scoreFor, report.archetype, (id) => present.has(id));
  const rigorScore = axisScore("rigor", scoreFor, report.archetype, (id) => present.has(id));
  return {
    dimensions,
    overall: projectScore(report, clamped),
    adoptionScore,
    rigorScore,
    posture: postureFor(adoptionScore, rigorScore),
  };
}

/**
 * The fewest, highest-leverage gaps to close to reach the next maturity band — a concrete,
 * motivating "how do I level up" path rather than a static grade. Greedily closes the
 * dimensions with the most weighted upside first (each contributes the most overall points per
 * dimension changed) and stops as soon as the projection crosses the next band floor.
 */
export function cheapestPathToNextLevel(report: ScanReport): LevelPath {
  // nextLevelOf treats an unrecognized level id (schema drift / a legacy persisted scan) as the
  // lowest band rather than conflating "not found" with "already at the top" — the latter returned
  // reachable:true/target:null and rendered the repo as maxed out at L5 with no path to climb.
  const nextLevel = nextLevelOf(report.level.id);
  if (!nextLevel) {
    return { reachable: true, target: null, steps: [], projected: projectScore(report, {}) };
  }
  const targetScore = nextLevel.band[0];

  // True reachability first: project EVERY dimension to its ceiling (100). If even that can't reach
  // the band floor, the next level is genuinely unreachable (e.g. the remaining headroom lives in a
  // zero-weight dimension under this archetype lens) — return reachable:false with no misleading
  // "path", rather than letting the greedy loop below stop a rounding-point short and imply a climb
  // that never crosses. When the ceiling DOES clear the floor, the greedy steps are guaranteed to.
  const ceilingOverrides: Partial<Record<DimensionId, number>> = {};
  for (const d of report.dimensions) ceilingOverrides[d.id] = 100;
  if (projectScore(report, ceilingOverrides).overallScore < targetScore) {
    return {
      reachable: false,
      target: { level: nextLevel.id, name: nextLevel.name, score: targetScore },
      steps: [],
      projected: projectScore(report, {}),
    };
  }

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
// Glass-box attribution — decompose the headline into per-dimension contributions.
// ---------------------------------------------------------------------------

/**
 * Decompose the overall headline into each dimension's signed marginal point contribution — the
 * first step toward a fully auditable "why this score" view.
 *
 * The headline is a renormalized, archetype-weighted *mean* of the per-dimension scores (see
 * {@link overallScoreFor}), i.e. it is linear in those scores. For a linear model a feature's
 * Shapley value collapses to its single weighted term, so a dimension's contribution is just
 * `points = (weight / Σweight) * score`. Those points sum to the (unrounded) overall, so a
 * waterfall stacking them lands exactly on the headline — the score is the sum of visible parts,
 * not a black box.
 *
 * `signed` re-centers each contribution on the headline (`weight/Σweight * (score - overall)`),
 * summing to ~0, so the UI can read which dimensions pull the overall *up* (positive) vs *drag*
 * it down (negative) relative to the repo's own weighted mean.
 *
 * Weights are the report's already lens-adjusted dimension weights, renormalized over just the
 * dimensions present — the same defensive renormalization the engine uses — so a dropped or
 * partial dimension can't make the parts disagree with the headline.
 */
export function contributions(report: ScanReport): ContributionBreakdown {
  const dims = report.dimensions;
  const wsum = dims.reduce((acc, d) => acc + d.weight, 0);
  const overall = report.overallScore;

  const out: DimensionContribution[] = dims.map((d) => {
    const normalizedWeight = wsum > 0 ? d.weight / wsum : 0;
    return {
      dimension: d.id,
      name: d.name,
      score: d.score,
      weight: d.weight,
      normalizedWeight,
      points: normalizedWeight * d.score,
      // Intentionally re-centered on the DISPLAYED rounded headline (not the parts' weighted mean):
      // sum(signed) then surfaces the gap between the parts and the headline (rounding + any guardband
      // adjustment), which a glass-box wants to show. See the "residual = rounding only" engine test.
      signed: normalizedWeight * (d.score - overall),
    };
  });

  const total = out.reduce((acc, c) => acc + c.points, 0);
  return { overallScore: overall, total, dimensions: out };
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
