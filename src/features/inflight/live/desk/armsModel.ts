// THE ARM LEAGUE — every lane grouped by what it ran on. Pure.
//
// An arm is the lane's label (the run's arm when it had one, else the model it recorded); a lane with
// neither is "model not recorded", never "default". $ per verified close divides the cost of the lanes
// that RECORDED one by the closes OF THOSE SAME LANES, so an unpriced lane's closes never make a priced
// arm look cheaper — and an arm with no priced close has no figure at all (null), not $0.

import type { DeskRound, VerdictCounts } from "./roundsModel";
import { zeroVerdicts } from "./roundsModel";
import { verdictKey } from "./deskFormat";
import type { RoundLane } from "./deskTypes";

export const ARM_UNRECORDED = "model not recorded";

export interface ArmRow {
  key: string;
  /** The executing half of a split arm ("pi:qwen3.8:27b"), or the whole key. */
  exec: string;
  /** The planning half of a split arm, else null. */
  plan: string | null;
  lanes: number;
  closes: number;
  costMicros: number;
  costLanes: number;
  closesOnCosted: number;
  errors: number;
  verdicts: VerdictCounts;
  perCloseMicros: number | null;
  firstSeq: number | null;
  lastSeq: number | null;
  /** Lane ids, newest round first — the arm page's table. */
  laneIds: string[];
}

export const armKeyOf = (l: Pick<RoundLane, "armLabel" | "model">): string => l.armLabel || l.model || ARM_UNRECORDED;

/** "claude:sonnet plan -> pi:qwen3.8:27b" → plan + exec halves. */
export function splitArm(key: string): { exec: string; plan: string | null } {
  const i = key.indexOf(" -> ");
  if (i < 0) return { exec: key, plan: null };
  return { exec: key.slice(i + 4), plan: key.slice(0, i).replace(/ plan$/, "") };
}

export function foldArms(rounds: readonly DeskRound[]): ArmRow[] {
  const map = new Map<string, ArmRow & { seqs: number[] }>();
  for (const r of rounds) {
    for (const l of r.lanes) {
      const key = armKeyOf(l);
      let a = map.get(key);
      if (!a) {
        a = {
          key,
          ...splitArm(key),
          lanes: 0,
          closes: 0,
          costMicros: 0,
          costLanes: 0,
          closesOnCosted: 0,
          errors: 0,
          verdicts: zeroVerdicts(),
          perCloseMicros: null,
          firstSeq: null,
          lastSeq: null,
          laneIds: [],
          seqs: [],
        };
        map.set(key, a);
      }
      a.lanes++;
      a.closes += l.closes;
      if (l.costMicros != null) {
        a.costMicros += l.costMicros;
        a.costLanes++;
        a.closesOnCosted += l.closes;
      }
      if (l.errored) a.errors++;
      a.verdicts[verdictKey(l.verdict)]++;
      if (r.seq != null) a.seqs.push(r.seq);
      a.laneIds.unshift(l.id);
    }
  }
  return [...map.values()]
    .map(({ seqs, ...a }) => ({
      ...a,
      perCloseMicros: a.costLanes && a.closesOnCosted ? a.costMicros / a.closesOnCosted : null,
      firstSeq: seqs.length ? Math.min(...seqs) : null,
      lastSeq: seqs.length ? Math.max(...seqs) : null,
    }))
    .sort((x, y) => y.lanes - x.lanes || x.key.localeCompare(y.key));
}

/** "#10–#58", "#61", or "" when no lane of the arm carries a round number. */
export function seqRange(a: Pick<ArmRow, "firstSeq" | "lastSeq">): string {
  if (a.firstSeq == null || a.lastSeq == null) return "";
  return a.firstSeq === a.lastSeq ? `#${a.firstSeq}` : `#${a.firstSeq}–#${a.lastSeq}`;
}
