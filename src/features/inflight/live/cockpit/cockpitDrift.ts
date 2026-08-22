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

import { layoutBodies, type ObservatoryBody, type ObservatoryHistory, type ObservatorySeed } from "../observatory";
import type { LoopRunDetail } from "./loopTypes";

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
  const pairs = detail.outcomes.filter((o) => o.before && o.after);
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

/** Run-level lift: summed overall movement across the lanes that have both ends; null when none do. */
export function runLift(detail: LoopRunDetail): number | null {
  let sum = 0;
  let seen = 0;
  for (const o of detail.outcomes) {
    if (!o.before || !o.after) continue;
    sum += o.after.overallScore - o.before.overallScore;
    seen += 1;
  }
  return seen === 0 ? null : sum;
}
