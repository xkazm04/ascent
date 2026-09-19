// Pure score projections for browser controls and report consumers.
import type { ContributionBreakdown, DimensionContribution, DimensionId, LevelId, LevelPath, LevelPathStep, RepoArchetype, SandboxProjection, ScanReport, ScoreProjection } from "@/lib/types";
import { axisScore, clamp, levelForScore, levelIndex, nextLevel as nextLevelOf, overallScoreFor, postureFor } from "@/lib/maturity/model";

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

