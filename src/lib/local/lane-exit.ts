// THE LANE-EXIT DOOR — every way a lane cycle can end, and what each end owes (challenge-2026-09-23).
//
// A lane's end-of-life rule is short: RELEASE what you claimed, SETTLE what you planned, write ONE
// terminal phase, and report progress honestly. `runLane` used to restate that rule by hand at every
// exit (seventeen of them), and the copies drifted: one exit never flushed the activity tail, one
// settled a plan another would have left alone, the deferred settle re-implemented the release beside
// them. This module states the rule ONCE:
//
//   • `LANE_EXIT_KINDS` — the CLOSED vocabulary of lane ends. Adding an exit means adding a word here;
//     `laneExitObligations` is a `Record` over it, so a word with no row does not compile, and the
//     table test enumerates every word.
//   • `laneExitObligations` — the pure table: for each kind, whether the claim is released, whether an
//     executing plan is settled `failed`, the terminal phase, whether the cycle counts as progress, and
//     which commit count the row and the result carry.
//   • `exitLane` — the one door. It flushes the activity tail, releases or transfers the claim, settles
//     or leaves the plan, writes the terminal row, and returns the `LaneRunResult`. Nothing else in the
//     lane writes a terminal row (`lane-exit.test.ts` scans loop-lane.ts for it).
//
// Registry: `job-coordination` — a closed state vocabulary with one transition door, and every
// non-terminal state names its mover of last resort.

import { releaseFollowups } from "@/lib/db/followup-claims";
import { appendLaneLog, updateLane, type LoopLanePatch } from "@/lib/db/loop-runs";
import type { LoopLanePhase } from "@/lib/db/loop-runs-types";
import type { DeferredCycle, LaneRunResult } from "@/lib/local/loop-lane";

/** Who the LOCAL engine claims and releases as. Unchanged from the string the inline claim wrote, so
 *  the ledger's existing rows and this lane's new ones are the same actor. */
export const LANE_ACTOR = "autopilot";

/**
 * EVERY WAY A LANE CYCLE ENDS. Closed on purpose: an exit that is not one of these words is an exit
 * nobody has decided the obligations of.
 */
export const LANE_EXIT_KINDS = [
  /** No open gap and no craft rung — nothing was picked, nothing claimed. */
  "dry",
  /** Every item of the batch is held by another worker. */
  "held-by-others",
  /** A foundation/practice install that committed nothing. */
  "install-wrote-nothing",
  /** A plan-mode lane whose planner parked EVERY item as an architecture move. */
  "plan-parked-all",
  /** A runner lane whose dependency install failed — the edits are discarded, nothing commits. */
  "deps-held",
  /** The degradation guard reversed the session. */
  "guard-rejected",
  /** The real diff moved architecture its plan did not declare — parked on a held branch. */
  "fence-held",
  /** The lane edited the surface that scores it. */
  "void",
  /** A cooperative stop caught the lane before its rescan. */
  "stopped",
  /** The cycle committed nothing, so nothing is rescanned. */
  "no-commits",
  /** `"run"` cadence: the reading is deferred to the run's closing rescan, which inherits the claim. */
  "deferred",
  /** The rescan was taken but produced no reading — nothing adjudicated the claim. */
  "unread",
  /** The rescan ruled; the claim is now the scan feedback's to settle. */
  "adjudicated",
  /** An error, or a force-fail by the watchdog (deadline or stop). */
  "failed",
] as const;

export type LaneExitKind = (typeof LANE_EXIT_KINDS)[number];

export interface LaneExitObligations {
  /** Give back every row the lane still holds. False means the claim TRANSFERS (to the scan that
   *  ruled, or to the deferred settle) — it is never simply dropped. */
  release: boolean;
  /** Settle an executing plan `failed`, so the proposals ledger never shows it `executing` forever. */
  settlePlan: boolean;
  /** The terminal phase the row is written with. */
  phase: Extract<LoopLanePhase, "done" | "void" | "error">;
  /** Does this end count as progress — the signal the run keeps cycling a repo on? */
  progressed: boolean;
  /**
   * The commit count the end reports. `0` — the row and the result say zero whatever landed (the work
   * was discarded or parked). `"landed"` — the lane's real count, on the row and the result. `null` —
   * the lane ended before counting: the row is not touched and the result says zero.
   */
  commits: 0 | "landed" | null;
}

/**
 * THE TABLE. Each row is a decision that used to live at one call site.
 *
 * A few rows deserve their reason next to them:
 *   • `plan-parked-all` does NOT settle the plan: the plan it holds is the pending major plan the
 *     parked items now wait under, and settling it `failed` would throw away the operator's decision.
 *   • `fence-held` does not settle it either — the fence settles its own plan when it parks the work.
 *   • `deferred` and `adjudicated` release nothing: the claim moves to whoever reads the tree.
 *   • `adjudicated` / `unread` / `deferred` count as progress because they are reached only after the
 *     no-commit exit, so the lane landed at least one commit.
 */
export const laneExitObligations: Record<LaneExitKind, LaneExitObligations> = {
  dry: { release: true, settlePlan: false, phase: "done", progressed: false, commits: null },
  "held-by-others": { release: true, settlePlan: true, phase: "done", progressed: false, commits: null },
  "install-wrote-nothing": { release: true, settlePlan: false, phase: "done", progressed: false, commits: null },
  "plan-parked-all": { release: true, settlePlan: false, phase: "done", progressed: false, commits: null },
  "deps-held": { release: true, settlePlan: true, phase: "done", progressed: false, commits: 0 },
  "guard-rejected": { release: true, settlePlan: true, phase: "done", progressed: false, commits: 0 },
  "fence-held": { release: true, settlePlan: false, phase: "done", progressed: false, commits: 0 },
  void: { release: true, settlePlan: true, phase: "void", progressed: false, commits: "landed" },
  stopped: { release: true, settlePlan: true, phase: "done", progressed: false, commits: "landed" },
  "no-commits": { release: true, settlePlan: true, phase: "done", progressed: false, commits: "landed" },
  deferred: { release: false, settlePlan: false, phase: "done", progressed: true, commits: "landed" },
  unread: { release: true, settlePlan: false, phase: "done", progressed: true, commits: "landed" },
  adjudicated: { release: false, settlePlan: false, phase: "done", progressed: true, commits: "landed" },
  failed: { release: true, settlePlan: true, phase: "error", progressed: false, commits: null },
};

/**
 * What the door needs to know about the lane that is ending. MUTABLE by design: the lane updates
 * `claimedIds` as it claims, parks and adjudicates, `planId` once it plans, and `activity` once it
 * opens a tail — so whichever exit it reaches, the door sees the lane as it is at that moment.
 */
export interface LaneExitContext {
  laneId: string;
  /** The rows this lane still holds. The door empties it: released, or transferred. */
  claimedIds: string[];
  /** The executing plan this lane runs under, if any. */
  planId: string | null;
  /** The live activity tail, once the lane opened one. Flushed first, so no trailing write outlives
   *  the lane and the row's last activity is the session's real last word. */
  activity: { flush(): Promise<void> } | null;
  settlePlan: (planId: string | null) => Promise<void>;
}

export function createLaneExitContext(laneId: string, settlePlan: (planId: string | null) => Promise<void>): LaneExitContext {
  return { laneId, claimedIds: [], planId: null, activity: null, settlePlan };
}

/** What one particular exit carries beyond its kind. */
export interface LaneExitDetail {
  /** Why the claim is released — lands on each row's ledger note. */
  why?: string;
  /** One line for the lane log, written BEFORE the terminal row (the reason, then the end). */
  log?: string;
  /** `failed` only: the error on the row and the result. */
  error?: string;
  /** `failed` only: the stage that was in flight — the forensics of a force-fail. Null otherwise. */
  stage?: string | null;
  /** The lane's landed commit count, for a `"landed"` kind. */
  commits?: number;
  closed?: number;
  /** A plan the lane is holding that is not (yet) on the context — an approved direction whose batch
   *  was lost to other workers before the lane adopted it. */
  planId?: string | null;
  /** Extra columns on the terminal row (the void reason, the adjudicated pair and deliverables). */
  patch?: Omit<LoopLanePatch, "phase" | "stage" | "endedAt" | "error" | "commits">;
  deferred?: DeferredCycle;
  scan?: { scanId: string | null; closedIds: string[] };
}

/**
 * Release rows through the one release path, as this engine's actor. Never throws — a release that
 * fails leaves a row for the claim path's own recovery, never a failed lane.
 */
export async function releaseLaneClaims(ids: readonly string[], why: string): Promise<void> {
  if (ids.length > 0) await releaseFollowups(ids, why, LANE_ACTOR).catch(() => 0);
}

/** THE DOOR. Every lane end goes through here, in this order: flush → claim → plan → log → row. */
export async function exitLane(ctx: LaneExitContext, kind: LaneExitKind, detail: LaneExitDetail = {}): Promise<LaneRunResult> {
  const duty = laneExitObligations[kind];
  if (ctx.activity) await ctx.activity.flush().catch(() => undefined);
  const held = ctx.claimedIds;
  // Emptied either way: released here, or now owned by the scan / the deferred settle. A later failure
  // path must never release rows this lane no longer holds.
  ctx.claimedIds = [];
  if (duty.release) await releaseLaneClaims(held, detail.why ?? `loop lane ended (${kind})`);
  if (duty.settlePlan) await ctx.settlePlan(detail.planId !== undefined ? detail.planId : ctx.planId);
  if (detail.log) await appendLaneLog(ctx.laneId, detail.log);
  const commits = duty.commits === "landed" ? (detail.commits ?? 0) : 0;
  const wroteCommits = duty.commits === 0 || (duty.commits === "landed" && detail.commits !== undefined);
  await updateLane(ctx.laneId, {
    phase: duty.phase,
    ...(duty.phase === "error" ? { error: detail.error ?? "The lane failed." } : {}),
    ...(wroteCommits ? { commits } : {}),
    ...detail.patch,
    stage: duty.phase === "error" ? (detail.stage ?? null) : null,
    endedAt: new Date(),
  });
  return {
    laneId: ctx.laneId,
    progressed: duty.progressed,
    commits,
    closed: detail.closed ?? 0,
    error: duty.phase === "error" ? (detail.error ?? "The lane failed.") : null,
    ...(detail.deferred ? { deferred: detail.deferred } : {}),
    ...(detail.scan ? { scan: detail.scan } : {}),
  };
}
