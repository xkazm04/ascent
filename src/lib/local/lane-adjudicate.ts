// THE ADJUDICATION TAIL — what a lane does once a rescan has ruled on its commits (challenge-2026-09-23).
//
// There are two moments a lane's work is ruled on: a `"cycle"` lane rescans its own worktree the
// moment it commits, and a `"run"` lane's cycles are ruled on together by the run's ONE closing
// rescan (`settleDeferredCycles`). The tail after the reading is the same in both — the deliverable
// headlines, the terminal row, the per-item outcomes, the lessons and the playbook stamps — and it
// used to exist twice. The copies drifted: the deferred copy wrote none of the three log lines a
// reader of a `"cycle"` lane gets ("Delivered: …", the lessons line, the playbooks line). This is the
// one copy both call, so a lane's log reads the same whichever cadence ruled on it.
//
// The terminal row is written through the caller's `close` — the lane-exit door — so this module
// never decides a phase: it hands the adjudicated columns over and carries on with the tail.

import { appendLaneLog, type LoopLanePatch } from "@/lib/db/loop-runs";
import { BASE_DIVERGED_NOTE, type LaneDeliverable, type LoopLaneKind } from "@/lib/db/loop-runs-types";
import { recordLaneOutcomes } from "@/lib/db/lane-outcomes";
import { stampPlaybookApplications } from "@/lib/db/playbooks";
import { recordLoopLessons } from "@/lib/db/loop-lessons";
import { attributeDelivered, type BaseRelation } from "@/lib/maturity/attribution";
import { diffScans } from "@/lib/report/compare";
import { deriveLaneDeliverables, type AgentClaim } from "@/lib/local/lane-deliverables";
import { isAgentLaneKind } from "@/lib/local/lane-kind";
import type { LaneReport } from "@/lib/local/lane-report";
import type { FollowUpItem } from "@/lib/org/followups";
import type { LaneDeps } from "@/lib/local/loop-lane";

/** The three seams the headlines need. */
export type AdjudicateDeps = Pick<LaneDeps, "loadPair" | "baseRelation" | "summarize">;

/** The columns an adjudicated lane's terminal row carries beyond its phase. */
export type AdjudicatedColumns = Pick<LoopLanePatch, "closedIds" | "afterScanId" | "deliverables">;

export interface AdjudicateInput {
  org: string;
  repo: string;
  runId: string;
  laneId: string;
  cycle: number;
  kind: LoopLaneKind;
  beforeScanId: string | null;
  afterScanId: string | null;
  commits: number;
  /** The ids the reading closed that THIS lane is credited with. */
  closedIds: string[];
  batch: readonly FollowUpItem[];
  agentClaims: readonly AgentClaim[];
  report: LaneReport | null;
  briefedPlaybooks: readonly { id: string; dimId: string }[];
  practiceId: string | null;
  /** A runner lane the guard VERIFIED: its lessons are kept without waiting for a human. */
  autoKeepLessons: boolean;
  /** The lane's worktree — the one checkout that holds both ends' commits. */
  cwd: string;
}

/**
 * The lane's deliverable headlines, or null when the pair could not be read. Never throws.
 * The verdict is `attributeDelivered` over the same pair the ledger renders, so a lane that
 * committed nothing, straddled the mock floor or moved inside the noise band gets its closes and
 * its install as headlines and NO movement line — the prose refuses exactly where the number does.
 */
export async function laneDeliverables(
  deps: AdjudicateDeps,
  args: {
    org: string;
    repo: string;
    kind: LoopLaneKind;
    beforeScanId: string | null;
    afterScanId: string | null;
    commits: number;
    closedIds: string[];
    agentClaims: readonly AgentClaim[];
    practiceName: string | null;
    /** The lane's worktree — the one checkout that holds BOTH ends' commits, so the only place the
     *  base question can be asked. */
    cwd: string;
    /** Told what git concluded, so the caller can put the disclosure on the lane log too. */
    onBase?: (rel: BaseRelation) => void;
  },
): Promise<LaneDeliverable[] | null> {
  try {
    const pair = await deps.loadPair({ orgSlug: args.org, repoFullName: args.repo, beforeScanId: args.beforeScanId, afterScanId: args.afterScanId });
    const before = pair?.before ?? null;
    const after = pair?.after ?? null;
    // ARE THE TWO ENDS EVEN COMPARABLE? A pair whose ends sit on divergent commits measured two
    // different trees (see lane-base.ts). Anything git cannot answer is `unknown`, which refuses
    // nothing — this call can only ever take a claim away, never manufacture one.
    const base = await deps.baseRelation(args.cwd, before, after).catch(() => "unknown" as const);
    args.onBase?.(base);
    const derived = deriveLaneDeliverables({
      kind: args.kind,
      agentClaims: args.agentClaims,
      diff: before && after ? diffScans(before, after) : null,
      before,
      after,
      verdict: attributeDelivered(before, after, args.commits, base),
      base,
      practiceName: args.practiceName,
      closedFollowUpIds: args.closedIds,
      // Half of the TOTALITY test: a lane that committed must produce a headline even when nothing
      // it closed can be resolved to a title. See lane-deliverables.ts §4.
      commits: args.commits,
    });
    if (derived.length === 0) return derived;
    return await deps.summarize(derived, args.org).catch(() => derived);
  } catch {
    return null;
  }
}

/**
 * Rule on one lane against a reading: headlines → terminal row (through `close`) → the tail.
 * Returns whatever `close` returned, so the cycle path hands its `LaneRunResult` straight back.
 */
export async function adjudicateLane<T>(deps: AdjudicateDeps, a: AdjudicateInput, close: (columns: AdjudicatedColumns) => Promise<T>): Promise<T> {
  // WHAT THE LANE DELIVERED, as headlines (lane-deliverables.ts): the agent's claims, the install,
  // and the ATTRIBUTABLE part of the diff — under the same verdict the ledger's number answers to.
  // Best-effort end to end: a failed pair read or a polish that never answers leaves the column
  // null, and the read side derives the same list from what is persisted.
  const deliverables = await laneDeliverables(deps, {
    org: a.org,
    repo: a.repo,
    kind: a.kind,
    beforeScanId: a.beforeScanId,
    afterScanId: a.afterScanId,
    commits: a.commits,
    closedIds: a.closedIds,
    agentClaims: a.agentClaims,
    practiceName: a.practiceId ? a.practiceId.replace(/[-_]+/g, " ") : null,
    cwd: a.cwd,
    // SAY IT IN THE LOG TOO. The disclosure row explains the ledger; this explains the run to
    // somebody reading the lane while it happens, and it is the only place the fact survives if the
    // deliverable derivation itself falls over.
    onBase: (rel) => {
      if (rel === "diverged") void appendLaneLog(a.laneId, BASE_DIVERGED_NOTE).catch(() => null);
    },
  });
  const result = await close({ closedIds: a.closedIds, afterScanId: a.afterScanId, ...(deliverables ? { deliverables } : {}) });
  if (deliverables && deliverables.length > 0) {
    await appendLaneLog(a.laneId, `Delivered: ${deliverables.map((d) => d.headline).join(" · ")}`);
  }
  // PER-ITEM OUTCOMES, after the rescan has ruled. The rescan's close wins over any claim; an id
  // the agent said it SKIPPED is parked so the next cycle asks a different question instead of
  // spending another session on the same refusal. Nothing on the Recommendation row changes — a
  // deferral is advisory to `openBatch` alone.
  if (!isAgentLaneKind(a.kind) || a.batch.length === 0) return result;
  await recordLaneOutcomes({
    orgSlug: a.org,
    runId: a.runId,
    laneId: a.laneId,
    repoFullName: a.repo,
    cycle: a.cycle,
    batchIds: a.batch.map((b) => b.id),
    closedIds: a.closedIds,
    report: a.report,
  }).catch(() => []);

  // LESSONS, as CANDIDATES — with ONE exception. A lesson is an unattended agent's claim about what
  // this organization should believe, and the brief reads memory as truth, so a human keeps or
  // discards it through the lessons inbox. The exception (spark theater-upgrade, operator decision):
  // a RUNNER lane the guard VERIFIED has its lessons kept automatically, through the same memory door
  // and its duplicate check, tagged runner-kept and revocable from the ledger (loop-lessons-runner.ts).
  if (a.report && a.report.lessons.length > 0) {
    const kept = await recordLoopLessons(a.org, a.repo, a.laneId, a.report.lessons, { autoKeep: a.autoKeepLessons }).catch(() => []);
    if (kept.length > 0) {
      const auto = kept.filter((k) => k.status === "kept").length;
      await appendLaneLog(
        a.laneId,
        auto > 0
          ? `${auto} lesson(s) kept into ${a.repo}'s procedural memory by the runner (verified lane — revocable from the ledger)${kept.length > auto ? `; ${kept.length - auto} left for review` : ""}.`
          : `${kept.length} lesson candidate(s) recorded for review — nothing was written into memory.`,
      );
    }
  }

  // ADOPTION EVIDENCE, on a verified close only. A row the rescan closed on a dimension the brief
  // carried a playbook for is the one case where "this repo now follows that playbook" is supported
  // by something other than hope — the agent read the steps and the verifier saw the dimension move.
  // A close under a playbook the brief never quoted stamps nothing.
  const closedDims = new Set(a.batch.filter((b) => a.closedIds.includes(b.id)).map((b) => b.dimId));
  const earned = a.briefedPlaybooks.filter((p) => closedDims.has(p.dimId)).map((p) => p.id);
  if (earned.length > 0) {
    const stamped = await stampPlaybookApplications(a.org, a.repo, earned).catch(() => 0);
    if (stamped > 0) {
      await appendLaneLog(a.laneId, `${stamped} playbook(s) from this lane's brief recorded as applied — the rescan verified the close.`);
    }
  }
  return result;
}
