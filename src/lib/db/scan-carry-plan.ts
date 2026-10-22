// The carry-forward PLAN for one rescan: which previous recommendation each new roadmap row inherits
// its tracked state from, which in-progress claims the rescan closed, and which it kept open and why.
//
// Pure and deterministic. persistScanReport computes this BEFORE its retried transaction opens and the
// transaction only applies it, so a withRetry replay re-applies the same plan instead of re-deciding
// (software-engineering / data-access: compute the unit of work, then let the transaction write it).
//
// THE PAIRING RULE. A kept in-progress row is PAIRED (its note attaches to the new row that restates
// it) if and only if the new scan restates it by title (isRestated). Every other keep is UNPAIRED: the
// new roadmap holds nothing that is the same gap, so the row is copied forward as in_progress
// explicitly, with its assignee, due date and claim, or the claim would vanish from the latest scan.
// Pairing used to come from a hand-list of three reasons, and the two it missed (within-noise,
// mock-scan) were looked up by a title nothing carried, and silently dropped.

import { matchRecommendations } from "@/lib/report/recommendation-identity";
import { decideInProgress, isRestated, keepNote, resolutionNote, type MovementEngines } from "@/lib/org/followups";

/** The previous scan's recommendation fields persist reads. The Prisma select is built from this. */
export const PREV_REC_SELECT = {
  id: true,
  dimId: true,
  title: true,
  status: true,
  assigneeLogin: true,
  targetDate: true,
  claimActor: true,
  claimExecutor: true,
  leaseUntil: true,
  needsHuman: true,
  impact: true,
  effort: true,
  rationale: true,
  firstStep: true,
  explore: true,
  levelUnlock: true,
  kind: true,
  craftAxis: true,
} as const;

/** One previous-scan recommendation row, as PREV_REC_SELECT reads it. */
export interface PrevRecRow {
  id: string;
  dimId: string;
  title: string;
  status: string;
  assigneeLogin: string | null;
  targetDate: Date | null;
  claimActor: string | null;
  claimExecutor: string | null;
  leaseUntil: Date | null;
  needsHuman: boolean;
  impact: string;
  effort: string;
  rationale: string;
  firstStep: string;
  explore: string;
  levelUnlock: string | null;
  kind: string;
  craftAxis: string | null;
}

/** The tracked state a row carries across scans: status, ownership and the work-queue claim. */
export interface TrackedState {
  status: string;
  assigneeLogin: string | null;
  targetDate: Date | null;
  claimActor: string | null;
  claimExecutor: string | null;
  leaseUntil: Date | null;
  needsHuman: boolean;
}

/** Fields of PREV_REC_SELECT a copy deliberately does not take from the previous row. `id` is identity
 *  (a copy is a NEW row), `status` is set by the caller, and the claim is nulled on any row that is not
 *  in_progress (a live lease rides only with the work it leases). */
export const COPY_IDENTITY_FIELDS = ["id"] as const;
export const COPY_RESET_FIELDS = ["status"] as const;
export const CLAIM_FIELDS = ["claimActor", "claimExecutor", "leaseUntil", "needsHuman"] as const;

/** The tracked state for a row written with `status`. The claim rides only with in_progress: dropping it
 *  there made a machine-held lease read as a human take; keeping it on a done row kept a dead lease. */
export function trackedState(prev: Partial<PrevRecRow> | null | undefined, status: string): TrackedState {
  const claim = status === "in_progress" ? prev : null;
  return {
    status,
    assigneeLogin: prev?.assigneeLogin ?? null,
    targetDate: prev?.targetDate ?? null,
    claimActor: claim?.claimActor ?? null,
    claimExecutor: claim?.claimExecutor ?? null,
    leaseUntil: claim?.leaseUntil ?? null,
    needsHuman: claim?.needsHuman ?? false,
  };
}

/** The one row copier: a previous recommendation re-written onto a new scan with `status`. Used for the
 *  resolved-done copy and the unpaired-keep copy; the carried copy takes its content from the new
 *  roadmap and its tracked state from `trackedState`, the same function this one ends with. */
export function copyRecRow(prev: PrevRecRow, status: "done" | "in_progress") {
  return {
    title: prev.title,
    dimId: prev.dimId,
    impact: prev.impact,
    effort: prev.effort,
    rationale: prev.rationale,
    firstStep: prev.firstStep,
    explore: prev.explore,
    levelUnlock: prev.levelUnlock,
    kind: prev.kind,
    craftAxis: prev.craftAxis,
    ...trackedState(prev, status),
  };
}

export interface CarryPlanInput {
  prevRecs: readonly PrevRecRow[];
  prevDims: readonly { dimId: string; score: number }[];
  /** The new scan's roadmap and dimension scores. */
  roadmap: readonly { dimension: string; title: string }[];
  dims: readonly { id: string; score: number }[];
  /** Follow-up ids the commit sample's Ascent-Resolves trailers named. */
  resolvedIds: ReadonlySet<string>;
  /** The engines behind the movement; null when there is no previous scan. */
  engines: MovementEngines | null;
  /** The scan reference the ledger notes cite (the short head sha, or "latest"). */
  scanRef: string;
}

export interface CarryPlan {
  /** carry[j] = the previous row index new roadmap row j inherits tracked state from, or null. */
  carry: (number | null)[];
  /** In-progress rows the rescan closed: copied forward as done with this note. */
  resolved: { prevIndex: number; note: string }[];
  /** Kept rows the new scan restates: the note attaches to new roadmap row `nextIndex`. */
  keptPaired: { prevIndex: number; nextIndex: number; note: string }[];
  /** Kept rows the new scan does not restate: copied forward as in_progress with this note. */
  keptUnpaired: { prevIndex: number; note: string }[];
}

export function planCarryForward(input: CarryPlanInput): CarryPlan {
  const { prevRecs, resolvedIds, engines, scanRef } = input;
  const prevDimScore = new Map(input.prevDims.map((d) => [d.dimId, d.score] as const));
  const nextDimScore = new Map(input.dims.map((d) => [d.id, d.score] as const));
  const movementOf = (dimId: string) => {
    const before = prevDimScore.get(dimId);
    const after = nextDimScore.get(dimId);
    return before == null || after == null ? null : { before, after };
  };
  const nextIds = input.roadmap.map((r) => ({ dim: r.dimension, title: r.title }));
  const carry = matchRecommendations(
    prevRecs.map((r) => ({ dim: r.dimId, title: r.title })),
    nextIds,
  );
  const plan: CarryPlan = { carry, resolved: [], keptPaired: [], keptUnpaired: [] };

  prevRecs.forEach((r, i) => {
    if (r.status !== "in_progress") return;
    const prevId = { dim: r.dimId, title: r.title };
    const restated = isRestated(prevId, nextIds);
    const movement = movementOf(r.dimId);
    // The row's KIND decides which resolve rule applies (decideInProgress's craft rule).
    const decision = decideInProgress({ id: r.id, kind: r.kind === "craft" ? "craft" : "gap" }, restated, resolvedIds, movement, engines);
    if (decision.kind === "done") {
      plan.resolved.push({ prevIndex: i, note: resolutionNote(decision, scanRef) });
      // Un-pair any next item carry-forward matched to this row: it is not the same gap.
      carry.forEach((m, j) => {
        if (m === i) carry[j] = null;
      });
      return;
    }
    // A claimed row is carried by its TITLE or not at all: matchRecommendations does not report its
    // tier, so drop any pairing to this row that is not a title-tier restatement (tier 3 would carry
    // the claim onto whatever new gap the dimension produced).
    carry.forEach((m, j) => {
      if (m === i && !isRestated(prevId, [nextIds[j]!])) carry[j] = null;
    });
    const note = keepNote(decision, scanRef, movement, engines);
    if (!restated) {
      plan.keptUnpaired.push({ prevIndex: i, note });
      return;
    }
    if (!note) return; // a plain restatement rides carry-forward with nothing to explain
    // The new row that restates it: the one carry-forward paired to it, else the first title-tier match.
    const paired = carry.findIndex((m) => m === i);
    const nextIndex = paired >= 0 ? paired : nextIds.findIndex((n) => isRestated(prevId, [n]));
    plan.keptPaired.push({ prevIndex: i, nextIndex, note });
  });
  return plan;
}
