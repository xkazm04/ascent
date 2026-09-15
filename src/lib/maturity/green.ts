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
//
// AND SOME DIMENSIONS CANNOT BE READ AT ALL FROM WHERE THE LOOP STANDS. D2/D3/D4 are credited partly
// for tooling that is INSTALLED rather than committed — review/CI/coverage Apps posting check suites,
// default-branch Actions health (analyze/platform-signals.ts) — which a worktree scan cannot observe.
// When the last observed fold can be carried forward it is (analyze/platform-carry.ts) and nothing
// here changes. When there is none, demanding L5 on those three would be demanding a number the
// reading had no way to produce, and the loop would drive at it forever. `unmeasurableDims` excludes
// them instead — from the gaps, from the debt, and from `contested`. Excluded is NOT passed: a repo
// whose every dimension is unmeasurable is not green, for the same reason an unscanned one is not.

import { LEVEL_BY_ID, LLM_GUARDBAND, levelForScore } from "@/lib/maturity/model";
import { CLAIM_SCORED_DIMENSIONS } from "@/lib/scoring/claims";
import type { LevelId } from "@/lib/types";

/** The band a dimension must reach. The top of the ladder, by definition of "green". */
export const GREEN_LEVEL: LevelId = "L5";

/** Lowest score that lands in the green band — derived, never typed as a literal. */
export const GREEN_MIN_SCORE: number = LEVEL_BY_ID[GREEN_LEVEL].band[0];

export interface DimScore {
  dimId: string;
  score: number;
  /** The deterministic detector's score. Optional: older reads project only `score`. */
  signalScore?: number;
  /** The model's score BEFORE the guardband clamped it. Optional, as above. */
  llmScore?: number;
  /** True when this dimension's band was doubled because the model flagged the detector as suspect
   *  (`scoreIntegrity.widenedDims`). Changes the threshold a disagreement has to clear to count. */
  widened?: boolean;
}

/**
 * CONTESTED — the model disagreed with the detector by more than it was allowed to act on.
 *
 * The engine clamps the LLM to within ±LLM_GUARDBAND of the deterministic signal (±2× for a flagged
 * dimension), so the final score sits within ~±4 points of the detector no matter how strongly the
 * model objected. When `|llmScore - signalScore|` exceeds the band, the clamp BOUND: the model
 * wanted to move the number further than the architecture permits, and the score you are reading is
 * the detector's opinion, not the reconciled one.
 *
 * That is normally a footnote. For a loop driving a number to a target it is the whole ballgame,
 * because the cheapest way to raise a detector score is to satisfy the detector rather than do the
 * work — and the model noticing exactly that is what a bound clamp looks like from the outside.
 * See docs/SCORING-VALIDITY.md.
 *
 * Unknowable without both scores, and an absent answer is reported as NOT contested rather than
 * guessed: a read that projects only `score` must not manufacture suspicion it has no evidence for.
 */
export function isContested(d: DimScore): boolean {
  // A CLAIM-SCORED dimension (D4, r9) has no guardband: the model's score field is recorded and
  // ignored, and its opinion is expressed as citations that award nothing unless verified. So
  // |llm - signal| there is not "the model was clamped" — it is a number nothing acted on. The first
  // live r9 run flagged kp's D4 contested on exactly that noise. The gaming door this predicate
  // guards is closed for such dimensions by construction (an unverifiable claim scores zero).
  if ((CLAIM_SCORED_DIMENSIONS as readonly string[]).includes(d.dimId)) return false;
  if (typeof d.signalScore !== "number" || typeof d.llmScore !== "number") return false;
  const band = d.widened ? LLM_GUARDBAND * 2 : LLM_GUARDBAND;
  return Math.abs(d.llmScore - d.signalScore) > band;
}

/** One dimension that has not cleared the band yet, with the distance still to cover. */
export interface DimGap {
  dimId: string;
  score: number;
  level: LevelId;
  /** Points from this score to the bottom of the green band. Zero for a contested dimension that is
   *  already numerically green — its remaining work is evidential, not arithmetic. */
  points: number;
  /** The model disagreed with the detector by more than the guardband allowed. See isContested. */
  contested?: true;
}

export interface RepoGreenness {
  fullName: string;
  /** True only when at least one dimension was scored AND every one of them is green. */
  green: boolean;
  /** Nothing scored yet — distinct from "scored and failing", and the reason `green` is false. */
  unscanned: boolean;
  gaps: DimGap[];
  /** Dimension ids where the clamp bound — present even when the dimension is numerically green,
   *  because "the detector is satisfied and the model objects" is the state worth surfacing. */
  contested: string[];
  /** Dimension ids this reading could not measure and therefore did not judge — typically D2/D3/D4
   *  on a worktree scan with no GitHub-side fold to carry. Named, never silently dropped: a verdict
   *  reached over six dimensions must not look like one reached over nine. */
  unmeasurable: string[];
  /** Total points across every gap — the cheap ordering key for "what needs the most work". */
  debt: number;
}

export function isDimGreen(score: number): boolean {
  return levelForScore(score).id === GREEN_LEVEL;
}

/**
 * Score one repo's latest dimensions against the target. Pure; order of `dims` is irrelevant.
 *
 * `unmeasurableDims` names dimensions this reading could not measure at all (see the header). They
 * are held out of the verdict rather than counted as failed — and they are reported, because a green
 * light standing on three excluded dimensions is a different claim from one standing on nine.
 */
export function repoGreenness(
  fullName: string,
  dims: readonly DimScore[],
  unmeasurableDims: readonly string[] = [],
): RepoGreenness {
  if (dims.length === 0) {
    // An unscanned repo is not green, and saying so explicitly is what keeps a loop from reporting
    // victory over a fleet it never measured.
    return { fullName, green: false, unscanned: true, gaps: [], contested: [], unmeasurable: [], debt: 0 };
  }
  const excluded = new Set(unmeasurableDims);
  const unmeasurable: string[] = [];
  const gaps: DimGap[] = [];
  const contested: string[] = [];
  for (const d of dims) {
    if (excluded.has(d.dimId)) {
      // Nothing is asserted about it in EITHER direction: it raises no gap, adds no debt, and is
      // never called contested — a disagreement between a detector and a model over a number neither
      // could observe is not a signal about the repository.
      unmeasurable.push(d.dimId);
      continue;
    }
    // A CONTESTED dimension is never green, whatever its number says. The clamp bound, so the score
    // is the detector's verdict over the model's objection — and "the detector is satisfied" is
    // precisely the state a loop reaches by satisfying the detector. Counting it as arrived would
    // let the loop declare victory on the one reading that suggests it cheated.
    if (isContested(d)) contested.push(d.dimId);
    if (isDimGreen(d.score) && !isContested(d)) continue;
    const level = levelForScore(d.score).id;
    gaps.push({
      dimId: d.dimId,
      score: d.score,
      level,
      // A contested dimension that is already at/above the band has no numeric distance left to
      // cover; its remaining work is evidential, so it carries zero points rather than a negative.
      points: Math.max(0, GREEN_MIN_SCORE - Math.round(d.score)),
      contested: isContested(d) || undefined,
    });
  }
  // Widest gap first: a loop with a bounded number of cycles should spend them where the distance is.
  gaps.sort((a, b) => b.points - a.points || a.dimId.localeCompare(b.dimId));
  return {
    fullName,
    // Every MEASURED dimension cleared the band — and at least one was measured. A repo whose whole
    // dimension set was excluded has produced no evidence of anything, which is the unscanned case
    // wearing different clothes, and vacuous green is the one verdict a drive must never report.
    green: gaps.length === 0 && unmeasurable.length < dims.length,
    unscanned: false,
    gaps,
    contested,
    unmeasurable,
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
