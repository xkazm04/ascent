// Org-level "what-if" simulator — recompute the fleet's averages and posture mix under a
// hypothetical fix applied to a chosen set of repos ("raise D2 to 70 on these 5 repos →
// org Rigor 47→55, two repos cross to L3"). Pure and deterministic: it re-runs the SAME
// archetype-weighted blend the live engine uses (model.ts), so a projection is consistent
// with how each repo's headline score was actually computed. No DB, no Date.now().
//
// This is the management-layer counterpart to the single-repo projectScore() in engine.ts:
// there you simulate one repo's gaps; here you simulate a fix landing across the fleet.

import type { DimensionId, Posture, RepoArchetype } from "@/lib/types";
import { DIMENSIONS, axisScore, clamp, levelForScore, postureFor, weightsFor } from "@/lib/maturity/model";

/** A repo reduced to what the simulator needs: its archetype lens + per-dimension scores. */
export interface RepoDims {
  fullName: string;
  name: string;
  archetype: RepoArchetype;
  dims: Record<string, number>;
}

/** The metric a scenario targets: a single dimension, or one of the two axes / the overall. */
export type SimMetric = DimensionId | "overall" | "adoption" | "rigor";

/** One leg of a scenario: raise `dimId` to `target` across the scope. */
export interface SimFix {
  dimId: DimensionId;
  target: number;
}

export interface FleetSnapshot {
  repos: number; // repos with a latest scan
  avgOverall: number;
  avgAdoption: number;
  avgRigor: number;
  /** Maturity level of the fleet average overall. */
  level: string;
  postureCounts: Record<string, number>;
}

export interface RepoSimDelta {
  fullName: string;
  name: string;
  overallBefore: number;
  overallAfter: number;
  delta: number;
  levelBefore: string;
  levelAfter: string;
  levelUp: boolean;
}

export interface FleetProjection {
  /** The scenario applied — one leg per dimension raised (a single-dim fix is a one-element list). */
  fixes: SimFix[];
  scopeCount: number; // repos the scenario was applied to
  affected: number; // repos where at least one dimension was below target (so it moved)
  before: FleetSnapshot;
  after: FleetSnapshot;
  /** Per-repo movement, affected repos first (largest gain first). */
  repos: RepoSimDelta[];
  /** Repos that crossed up to a higher maturity band. */
  promotions: number;
}

/** Recompute a single repo's overall + axis scores from its dimension scores, under its lens. */
export function recomputeRepo(
  dims: Record<string, number>,
  archetype: RepoArchetype,
): { overall: number; adoption: number; rigor: number } {
  const lensW = weightsFor(archetype);
  const scoreFor = (id: DimensionId) => dims[id] ?? 0;
  const isPresent = (id: DimensionId) => dims[id] != null;
  // Renormalized weighted mean over the dimensions actually present — mirrors assembleReport.
  const present = DIMENSIONS.filter((d) => dims[d.id] != null);
  const wsum = present.reduce((a, d) => a + (lensW[d.id] ?? 0), 0);
  const overall = clamp(
    wsum > 0 ? Math.round(present.reduce((a, d) => a + scoreFor(d.id) * (lensW[d.id] ?? 0), 0) / wsum) : 0,
  );
  return {
    overall,
    // Renormalize each axis over the dimensions actually present too, so a partial scan's
    // adoption/rigor (and the posture derived from them) can't be deflated by absent dims.
    adoption: axisScore("adoption", scoreFor, archetype, isPresent),
    rigor: axisScore("rigor", scoreFor, archetype, isPresent),
  };
}

function snapshot(rows: { overall: number; adoption: number; rigor: number; posture: Posture }[]): FleetSnapshot {
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const postureCounts: Record<string, number> = {};
  for (const r of rows) postureCounts[r.posture.id] = (postureCounts[r.posture.id] ?? 0) + 1;
  const avgOverall = avg(rows.map((r) => r.overall));
  return {
    repos: rows.length,
    avgOverall,
    avgAdoption: avg(rows.map((r) => r.adoption)),
    avgRigor: avg(rows.map((r) => r.rigor)),
    level: levelForScore(avgOverall).id,
    postureCounts,
  };
}

/**
 * Project the fleet impact of a scenario — one or more `{dimId, target}` legs — applied to every
 * repo in `scope` (a set of fullNames). For each leg, a repo already at/above that target on that
 * dimension (or outside the scope) is left untouched; `affected` counts repos where at least one
 * leg moved. Returns before/after fleet snapshots plus per-repo deltas (affected first), and how
 * many repos crossed up a maturity band. A single-dimension what-if passes one `{dimId, target}`.
 */
export function simulateFleet(
  repos: RepoDims[],
  fix: SimFix | SimFix[],
  scope: Iterable<string>,
): FleetProjection {
  const inScope = new Set(scope);
  // Normalize to a list of legs with clamped integer targets.
  const fixes: SimFix[] = (Array.isArray(fix) ? fix : [fix]).map((f) => ({ dimId: f.dimId, target: clamp(Math.round(f.target)) }));

  const before = repos.map((r) => {
    const s = recomputeRepo(r.dims, r.archetype);
    return { repo: r, ...s, posture: postureFor(s.adoption, s.rigor) };
  });

  const after = repos.map((r) => {
    let dims = r.dims;
    let moved = false;
    // Apply each leg only when the repo is in scope AND currently below that leg's target.
    if (inScope.has(r.fullName)) {
      for (const f of fixes) {
        const cur = dims[f.dimId];
        if (cur == null || cur < f.target) {
          dims = { ...dims, [f.dimId]: f.target };
          moved = true;
        }
      }
    }
    const s = recomputeRepo(dims, r.archetype);
    return { repo: r, moved, ...s, posture: postureFor(s.adoption, s.rigor) };
  });

  const repoDeltas: RepoSimDelta[] = repos.map((r, i) => {
    const b = before[i]!; // safe: before is repos.map(...), so same length/index as repos
    const a = after[i]!; // safe: after is repos.map(...), so same length/index as repos
    const levelBefore = levelForScore(b.overall).id;
    const levelAfter = levelForScore(a.overall).id;
    return {
      fullName: r.fullName,
      name: r.name,
      overallBefore: b.overall,
      overallAfter: a.overall,
      delta: a.overall - b.overall,
      levelBefore,
      levelAfter,
      levelUp: Number(levelAfter.slice(1)) > Number(levelBefore.slice(1)),
    };
  });

  repoDeltas.sort((x, y) => y.delta - x.delta || x.fullName.localeCompare(y.fullName));
  const affected = after.filter((a) => a.moved).length;

  return {
    fixes,
    scopeCount: inScope.size,
    affected,
    before: snapshot(before),
    after: snapshot(after),
    repos: repoDeltas,
    promotions: repoDeltas.filter((r) => r.levelUp).length,
  };
}

/** One dimension's projected fleet payoff from raising it to `target` across `scope` (SIM-3). */
export interface InvestmentRank {
  dimId: DimensionId;
  name: string;
  target: number;
  /** Projected lift in the fleet's average overall score. */
  gain: number;
  /** Repos that would cross up a maturity band. */
  promotions: number;
  /** Repos currently below target (the ones the move would actually touch). */
  affected: number;
}

/**
 * "Where should we invest?" — run simulateFleet once per dimension (raising each to `target` across
 * `scope`) and rank the dimensions by projected lift in the fleet's average overall score. Reuses the
 * exact pure projection the manual simulator uses, so the recommendation and a hand-run what-if agree.
 */
export function rankFleetInvestments(
  repos: RepoDims[],
  scope: Iterable<string>,
  target = 70,
): InvestmentRank[] {
  const scopeArr = [...scope];
  const t = clamp(Math.round(target));
  const ranked = DIMENSIONS.map((d) => {
    const proj = simulateFleet(repos, { dimId: d.id, target: t }, scopeArr);
    return {
      dimId: d.id,
      name: d.name,
      target: t,
      gain: proj.after.avgOverall - proj.before.avgOverall,
      promotions: proj.promotions,
      affected: proj.affected,
    };
  });
  ranked.sort((a, b) => b.gain - a.gain || b.promotions - a.promotions || a.dimId.localeCompare(b.dimId));
  return ranked;
}
