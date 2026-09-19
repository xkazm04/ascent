// Turning a finished run into the field's DRIFT — the two body sets the observatory tweens between.
//
// WHERE THE ENDS COME FROM. Both of them come from the run's own detail, not from a snapshot the
// client took at start time and not from a post-run `router.refresh()`. `getLoopRunDetail` resolves
// every lane to the exact scan pair that BRACKETS its work (`beforeScanId`/`afterScanId`), and those
// scans carry adoption/rigor/overall/level directly. Reading both ends from there has three
// properties a snapshot cannot have:
//
//   1. It is correct for a run the browser never watched — a page opened after the fact, or a row
//      clicked in the history strip, drifts exactly like a run you sat through.
//   2. It cannot drift against the outcome ledger: the same pair of scans feeds both, so the picture
//      and the numbers can never tell two different stories.
//   3. It refuses to move a body it cannot measure. A lane with no `before` (a first-ever scan) is
//      left at its final position rather than glided in from an invented origin.
//
// Repos that were not in the run appear IDENTICALLY on both sides, so the drift moves only the
// bodies the run actually touched.

import { attributeDelivered, type Attribution } from "@/lib/maturity/attribution";
import { baseRelationOf } from "@/lib/db/loop-runs-types";
import { layoutBodies, type ObservatoryBody, type ObservatoryHistory, type ObservatorySeed } from "../observatory";
import type { LoopLaneOutcome, LoopRunDetail } from "./loopTypes";

/** The scan-end fields the overlay reads — `ComparableScan` satisfies it structurally. */
interface ScanEnd {
  overallScore: number;
  adoptionScore: number;
  rigorScore: number;
  level: string;
  posture: string;
  scannedAt: string;
}

const overlay = (seed: ObservatorySeed, end: ScanEnd): ObservatorySeed => ({
  ...seed,
  overall: end.overallScore,
  adoption: end.adoptionScore,
  rigor: end.rigorScore,
  level: end.level,
  posture: end.posture,
  scannedAt: end.scannedAt,
});

export interface CockpitDrift {
  before: ObservatoryBody[];
  after: ObservatoryBody[];
  runId: string;
}

/**
 * Build the drift for one run, or null when no lane has BOTH ends (nothing measurable moved, and a
 * drift over unmeasured bodies would be a lie about movement).
 *
 * `replayKey` distinguishes one press of "Replay run" from the next; the field replays whenever the
 * `runId` it is handed changes, so a replay is just this same pair under a new key.
 */
export function driftFor(
  seeds: readonly ObservatorySeed[],
  histories: readonly ObservatoryHistory[],
  detail: LoopRunDetail,
  replayKey = 0,
): CockpitDrift | null {
  // A lane that committed nothing is not part of the drift either. Its after-scan measured a
  // worktree that was deleted, so gliding a body to it would animate a position the repository never
  // reached — and the header comment's promise ("it cannot drift against the outcome ledger") is
  // exactly what would break if the sky moved a body the ledger below refuses to score.
  const pairs = detail.outcomes.filter((o) => o.before && o.after && o.commits > 0);
  if (pairs.length === 0) return null;
  const beforeBy = new Map(pairs.map((o) => [o.lane.repoFullName, o.before as ScanEnd]));
  const afterBy = new Map(pairs.map((o) => [o.lane.repoFullName, o.after as ScanEnd]));
  const beforeSeeds = seeds.map((s) => {
    const end = beforeBy.get(s.fullName);
    return end ? overlay(s, end) : s;
  });
  const afterSeeds = seeds.map((s) => {
    const end = afterBy.get(s.fullName);
    return end ? overlay(s, end) : s;
  });
  return {
    before: layoutBodies(beforeSeeds, histories),
    after: layoutBodies(afterSeeds, histories),
    runId: `${detail.run.id}:${replayKey}`,
  };
}

/**
 * The repos whose bodies should pulse. Both working phases count: an operator watching the sky wants
 * to see which repos are BUSY, and a lane with an agent mid-session is as busy as one mid-rescan.
 */
export function scanningRepos(detail: LoopRunDetail | null): ReadonlySet<string> {
  if (!detail) return new Set();
  return new Set(
    detail.lanes.filter((l) => l.phase === "dispatching" || l.phase === "rescanning").map((l) => l.repoFullName),
  );
}

/**
 * One lane's verdict — the same rule the resolve rule and the history strip apply, plus the lane's
 * commit count, which only a LANE has.
 *
 * The commit count is load-bearing and was missing until 2026-08-29 (L2-B-01): the loop scans a
 * worktree it is about to delete, so a lane that committed nothing measured a state that does not
 * survive the run. `runLane` now refuses to rescan such a lane at all, but the rows written before it
 * did are still in the database and the ledger renders them — so the refusal lives on BOTH sides.
 */
export const laneAttribution = (o: LoopLaneOutcome): Attribution =>
  // The fourth input is the lane's own base finding, recovered from the disclosure row it persisted
  // (`baseRelationOf`): a pair whose two ends were taken on divergent commits measured two different
  // trees, and its difference is not a lift or a regression in either direction. A lane that never
  // made the determination reads `unknown`, which refuses nothing.
  attributeDelivered(o.before, o.after, o.commits, baseRelationOf(o.deliverables));

export interface RunAttribution {
  /** Summed movement across the lanes whose movement is ATTRIBUTABLE; null when no lane is. */
  lift: number | null;
  attributable: number;
  /** Real on both ends, but the movement is inside the noise band. */
  withinNoise: number;
  /** At least one end came off the deterministic mock floor. */
  mock: number;
  /** No pair to compare (a first-ever scan, or a lane that never rescanned). */
  unmeasured: number;
  /** Measured, outside the band — and committed NOTHING, so the state it measured is gone. */
  undelivered: number;
}

/**
 * The run's totals, with the noise and the mock lanes held OUT of the headline number rather than
 * folded into it. A run that moved four repos by one point each used to read "+4 total lift"; every
 * one of those movements is inside a single re-run's wobble, and summing them manufactures a
 * significance none of them has. The counts are kept beside the number so the operator can see what
 * was excluded — a lift of null with three noise lanes is a different situation from a lift of null
 * with three mock lanes, and they call for different next moves.
 */
export function runAttribution(detail: LoopRunDetail): RunAttribution {
  const out: RunAttribution = { lift: null, attributable: 0, withinNoise: 0, mock: 0, unmeasured: 0, undelivered: 0 };
  let sum = 0;
  for (const o of detail.outcomes) {
    const a = laneAttribution(o);
    if (a.kind === "attributable") {
      out.attributable += 1;
      sum += a.delta;
    } else if (a.kind === "within-noise") out.withinNoise += 1;
    else if (a.kind === "mock-scan") out.mock += 1;
    else if (a.kind === "undelivered") out.undelivered += 1;
    else out.unmeasured += 1;
  }
  if (out.attributable > 0) out.lift = sum;
  return out;
}

/** Run-level lift: the attributable movement only; null when no lane produced any. */
export const runLift = (detail: LoopRunDetail): number | null => runAttribution(detail).lift;
