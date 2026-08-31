// THE OUTCOME MATRIX'S SHAPES — one column per run, one row-group per repo, one cell per (run, repo).
//
// Split out of `outcomeMatrix.ts` (which re-exports every name here, so no call site changed) purely
// to keep the fold under this tree's 200-line cap. The fold itself, and every rule about what may be
// claimed, stays there.

import type { Attribution } from "@/lib/maturity/attribution";
import type { LaneDeliverable } from "@/lib/db/loop-runs-types";
import type { GapRow } from "./outcomeGapRows";
import type { LoopLaneKind, LoopLanePhase, LoopLaneRecord, LoopRunPhase } from "../cockpit/loopTypes";

export interface OutcomeDim {
  id: string;
  short: string;
  delta: number;
  /** The pair is attributable AND this dimension's fold is comparable — the only case coloured. */
  claimable: boolean;
}

/**
 * THE DEGRADATION GUARD SAID THIS REPOSITORY WAS ALREADY RED — the one verdict that changes how every
 * other number in the cell should be read.
 *
 * A red baseline means the repository's OWN check was failing before the agent arrived, so the guard
 * had nothing green to compare against: it could not have caught a regression in this cell's work, and
 * it could not have confirmed a fix. Carried as its own field rather than the raw verdict because it
 * is the only one of the four the sheet surfaces — `verified` on every green row would be a badge
 * saying "normal", and `rejected` never reaches the sheet (a rejected lane commits nothing).
 */
export interface CellRedBaseline {
  command: string | null;
  /** The guard's full note, for the cell's `title` — where "why" survives the throwaway worktree. */
  note: string | null;
}

export interface OutcomeCell {
  runId: string;
  repo: string;
  kind: LoopLaneKind;
  /** "…installed" line for a deterministic lane; null for an agent lane (no tag says more than one). */
  installed: string | null;
  /** WHAT THE LANE DID, one headline each — grouped by kind (closed · installed · hardened ·
   *  regressed) then by dimension. */
  deliverables: LaneDeliverable[];
  /** ONE ROW PER GAP, with its state (committed · uncommitted · proposed), its lane and any
   *  standing review — the sheet's row axis is folded from these (outcomeGapRows.ts). */
  rows: GapRow[];
  /** The lane's PR, when an owner opened one — surfaced on the repo's group-header row. */
  prNumber: number | null;
  prUrl: string | null;
  /** The lane the group header offers the PR action against (the one that already has a PR, else the
   *  last). Carried whole because `LanePrAction` decides eligibility from the record itself. */
  lane: LoopLaneRecord;
  /** The full follow-up titles behind the `closed` headlines — evidence for the expanded view only. */
  titles: string[];
  verdict: Attribution;
  commits: number;
  gaps: number;
  dims: OutcomeDim[];
  /** Set when any lane of this (run, repo) recorded `baseline-red`; null otherwise, including for a
   *  lane written before the guard existed — unknown is not a claim. */
  redBaseline: CellRedBaseline | null;
  /** Humanised movement lines (`D9 −42 · lost token permissions, SAST…`) — EMPTY unless the cell's
   *  verdict is attributable: the prose answers to the same rule as the number. */
  movements: string[];
  phase: LoopLanePhase;
  stage: string | null;
  error: string | null;
}

export interface OutcomeColumn {
  id: string;
  startedAt: string;
  endedAt: string | null;
  phase: LoopRunPhase;
  live: boolean;
  lift: number | null;
  agentConfig: string | null;
  /** `landed` / `PR`, or null for the branch-only default — a reader of a past run has to be able to
   *  tell whether anything ever merged. */
  delivery: string | null;
  cycle: number;
  maxCycles: number;
  repoCount: number;
  gaps: number;
}

export interface OutcomeGroup {
  repo: string;
  /** Cumulative attributable lift across the visible columns; null when no cell is attributable. */
  lift: number | null;
  cells: Record<string, OutcomeCell>;
}

export interface OutcomeMatrix {
  columns: OutcomeColumn[];
  groups: OutcomeGroup[];
  latestId: string | null;
  totals: { lift: number | null; runs: number; gaps: number; repos: number };
}
