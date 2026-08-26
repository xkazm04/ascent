// GREEN — the termination condition for a drive-to-target loop.
//
// "Keep improving until it's green" needs green to be a predicate, not a feeling. Ascent already
// scores each of the nine dimensions 0..100 and bands them into L1..L5 (model.ts LEVELS), and the
// brand's ramp runs red at L1 to green at L5 — so green is the top band and nothing here invents a
// second scale. `levelForScore` is the ONE authority for score→level; this module never compares
// against 85 directly, because a future retune of the bands must move this predicate with it.
//
// WHY PER-DIMENSION AND NOT THE OVERALL SCORE. An overall of 85 is reachable with a dimension still
// at L2 — strong scores elsewhere carry it. A loop that stopped there would report success over a
// repo with an unaddressed weakness, which is the one outcome that makes the whole exercise
// worthless. Green means EVERY dimension cleared the band.
//
// A repo with no dimensions is deliberately NOT green (see `repoGreenness`): an unscanned repo and a
// perfect one must never be indistinguishable, and "no evidence" is the reading a loop can act on.

import { LEVEL_BY_ID, levelForScore } from "@/lib/maturity/model";
import type { LevelId } from "@/lib/types";

/** The band a dimension must reach. The top of the ladder, by definition of "green". */
export const GREEN_LEVEL: LevelId = "L5";

/** Lowest score that lands in the green band — derived, never typed as a literal. */
export const GREEN_MIN_SCORE: number = LEVEL_BY_ID[GREEN_LEVEL].band[0];

export interface DimScore {
  dimId: string;
  score: number;
}

/** One dimension that has not cleared the band yet, with the distance still to cover. */
export interface DimGap {
  dimId: string;
  score: number;
  level: LevelId;
  /** Points from this score to the bottom of the green band. Always >= 1 for a gap. */
  points: number;
}

export interface RepoGreenness {
  fullName: string;
  /** True only when at least one dimension was scored AND every one of them is green. */
  green: boolean;
  /** Nothing scored yet — distinct from "scored and failing", and the reason `green` is false. */
  unscanned: boolean;
  gaps: DimGap[];
  /** Total points across every gap — the cheap ordering key for "what needs the most work". */
  debt: number;
}

export function isDimGreen(score: number): boolean {
  return levelForScore(score).id === GREEN_LEVEL;
}

/** Score one repo's latest dimensions against the target. Pure; order of `dims` is irrelevant. */
export function repoGreenness(fullName: string, dims: readonly DimScore[]): RepoGreenness {
  if (dims.length === 0) {
    // An unscanned repo is not green, and saying so explicitly is what keeps a loop from reporting
    // victory over a fleet it never measured.
    return { fullName, green: false, unscanned: true, gaps: [], debt: 0 };
  }
  const gaps: DimGap[] = [];
  for (const d of dims) {
    if (isDimGreen(d.score)) continue;
    const level = levelForScore(d.score).id;
    gaps.push({ dimId: d.dimId, score: d.score, level, points: GREEN_MIN_SCORE - Math.round(d.score) });
  }
  // Widest gap first: a loop with a bounded number of cycles should spend them where the distance is.
  gaps.sort((a, b) => b.points - a.points || a.dimId.localeCompare(b.dimId));
  return {
    fullName,
    green: gaps.length === 0,
    unscanned: false,
    gaps,
    debt: gaps.reduce((sum, g) => sum + g.points, 0),
  };
}

export interface FleetGreenness {
  /** True only when every repo in scope is green. An EMPTY scope is not green — see below. */
  green: boolean;
  repos: RepoGreenness[];
  greenCount: number;
  /** Repos still short of the target, worst debt first — the loop's work list. */
  remaining: RepoGreenness[];
  totalDebt: number;
}

/**
 * Roll per-repo greenness into the fleet verdict a loop terminates on.
 *
 * An EMPTY scope reports `green: false`. Vacuous truth is the wrong answer here: "every repo is
 * green" over zero repos would let a misconfigured scope (nothing paired, nothing watched) read as a
 * finished job, which is precisely the failure a drive-to-green loop must never report.
 */
export function fleetGreenness(repos: readonly RepoGreenness[]): FleetGreenness {
  const remaining = repos.filter((r) => !r.green).sort((a, b) => b.debt - a.debt || a.fullName.localeCompare(b.fullName));
  const greenCount = repos.length - remaining.length;
  return {
    green: repos.length > 0 && remaining.length === 0,
    repos: [...repos],
    greenCount,
    remaining,
    totalDebt: remaining.reduce((sum, r) => sum + r.debt, 0),
  };
}
