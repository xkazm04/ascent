// THE GREEN RESERVATION — how a lane's five slots are split between gaps and craft rungs.
//
// THE FAILURE THIS FIXES. r12 made the craft ladder dispatchable, but only through `openBatch`'s
// `gaps.length === 0` fallback — craft engaged when a repo had ZERO open gap items. Twelve campaign
// runs on two green repositories (kp overall 81, systedo-case 88; every dimension at or above
// FOLLOW_UP_BELOW after the unobservable-dimension fix) show that state never arrives: each rescan's
// model-judged roadmap raises one or two fresh gaps, so the batch is perpetually `backlog` with one
// or two items and the ladder is starved. `GET /api/org/loop/propose` between runs showed
// `kind: craft` with five well-formed rungs per repo — the ladder is built and working; it simply
// never got a turn.
//
// THE DOCTRINE, unchanged where it matters: a repo with a real hole gets NO craft budget at all. A
// NON-green repo's batch is gaps-only and byte-identical to what it was before this module existed.
// Only once every measured dimension has cleared the band do the gaps stop being allowed to fill the
// whole lane — and even then they still come first and still win the top slots.

import { repoGreenness, type DimScore } from "@/lib/maturity/green";
import { FOLLOW_UP_BELOW } from "@/lib/maturity/model";
import type { FollowUpItem } from "@/lib/org/followups";

/**
 * How many of a batch's slots gaps may take once the repo is green. The remaining
 * `BATCH_SIZE - GAP_SLOTS_AT_GREEN` go to the ladder.
 *
 * Two, not one and not four. One would let a single fresh roadmap entry crowd out nothing at all
 * while still reading as a gap lane; four would leave the ladder a token slot and reproduce the
 * starvation more slowly. Two gaps is a whole cycle's honest work on a repo that has no dimension
 * below the band, and three rungs is enough for the axis-coverage ranking to mean something.
 */
export const GAP_SLOTS_AT_GREEN = 2;

/**
 * GREEN, as the reservation means it: every dimension this reading could measure sits at or above
 * FOLLOW_UP_BELOW — the L4 floor, which `src/lib/maturity/model.ts` names as where green starts and
 * which the roadmap-coverage guarantee, the overview ledger and the drill-in copy all already use.
 *
 * IT DELEGATES TO `repoGreenness` RATHER THAN RE-DERIVING ANYTHING. That predicate owns the three
 * rules this must not restate: an unscanned repo is never green; a dimension the reading could not
 * measure is held out of the verdict in BOTH directions rather than counted as failed; and a repo
 * whose whole dimension set was excluded has produced no evidence of anything and is not green
 * either. Only the threshold differs, and it differs on purpose — `repoGreenness().green` asks the
 * stricter L5 question a drive terminates on, and gating craft on L5 would starve the ladder on
 * exactly the repositories it was built for.
 *
 * A CONTESTED dimension that is numerically at or above the floor still counts as green here. That
 * is deliberate and it is the L5 question's business, not this one's: `repoGreenness` already
 * refuses to call such a repo green, and a craft rung on a contested dimension is a rung, not a
 * claim that the dimension arrived.
 */
export function isReservationGreen(
  fullName: string,
  dims: readonly DimScore[],
  unmeasurableDims: readonly string[] = [],
): boolean {
  if (dims.length === 0) return false;
  const g = repoGreenness(fullName, dims, unmeasurableDims);
  if (g.unscanned) return false;
  // Every dimension excluded = a verdict reached over nothing. Vacuous green is the one answer a
  // reservation must never give, for the same reason `repoGreenness` refuses it.
  if (g.unmeasurable.length >= dims.length) return false;
  return g.gaps.every((gap) => gap.score >= FOLLOW_UP_BELOW);
}

/**
 * The MIXED batch: gaps first and capped, the remaining slots from the craft ladder.
 *
 * Pure and deterministic — both inputs arrive already ranked (gaps by the model's impact then
 * projected points, rungs by least-covered axis then impact), and this only decides how many of each
 * survive. Two properties the caller depends on:
 *
 *   • NO RUNGS ⇒ GAPS ONLY. A green repo whose scan produced no craft entries gets exactly the batch
 *     it would have got before the reservation existed. The cap is a reservation, not a ceiling: an
 *     empty ladder must never cost the lane slots it could be working.
 *   • SHORT LADDER ⇒ TOP BACK UP WITH GAPS. Same argument. If the ladder can only fill one of the
 *     three reserved slots, the other two go back to the gap list rather than shrinking the batch.
 */
export function reserveCraftSlots(
  gaps: readonly FollowUpItem[],
  rungs: readonly FollowUpItem[],
  limit: number,
): FollowUpItem[] {
  const size = Math.max(1, limit);
  if (rungs.length === 0) return gaps.slice(0, size);
  const head = gaps.slice(0, Math.min(GAP_SLOTS_AT_GREEN, size));
  const out = [...head, ...rungs.slice(0, size - head.length)];
  for (const g of gaps.slice(head.length)) {
    if (out.length >= size) break;
    out.push(g);
  }
  return out;
}

/** True when a batch carries BOTH a gap and a craft rung — the state `proposeLaneKind` names. */
export function isMixedBatch(items: readonly FollowUpItem[]): boolean {
  return items.some((it) => it.kind === "craft") && items.some((it) => it.kind !== "craft");
}
