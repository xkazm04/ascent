// The sandbox commit's model (roadmap-1): what "Commit to tracker" WILL do, shown before it writes,
// and what it DID, per row, after. Pure (no React, no db), so the hand-off route imports
// `sandboxCommitNote` from here and never from the client bar.
//
// remediation-roadmaps / sandbox-to-tracker-commit: "show what commit will do before it does it ...
// any item that will be skipped as already tracked", and "a surface that reports success at the batch
// level while writing at the item level will eventually claim a commit that half happened". So every
// applied item lands in exactly one bucket (start / skip with its status / unmatched), and after the
// one POST each started row reads tracked, held, not-open or failed.

import type { LlmRoadmapItem, PersistedRecommendation, RecStatus } from "@/lib/types";
import { recommendationMatchKey } from "@/lib/report/rec-identity";

export type SkipStatus = Exclude<RecStatus, "open">;

export interface SandboxCommitPlan {
  /** Persisted, still-open recs the commit will claim. Deduped by rec id. */
  start: PersistedRecommendation[];
  /** Matched recs already on the tracker, with the status that keeps them out of the commit. */
  skip: { rec: PersistedRecommendation; status: SkipStatus }[];
  /** Applied items with no persisted rec for this scan (a static fallback, or a rephrased item). */
  unmatched: LlmRoadmapItem[];
}

/**
 * Join the applied roadmap items to their persisted recs by the MINTED identity
 * (`recommendationMatchKey`: dimension + a hash over the normalized title), the same derivation
 * behind dismissal decisions and saved sandbox scenarios. A rendered title is display text, not
 * identity, so a live-LLM rephrasing between persist and render must still join.
 */
export function planSandboxCommit(
  roadmap: LlmRoadmapItem[],
  recs: PersistedRecommendation[] | null | undefined,
  appliedItems: Set<number>,
): SandboxCommitPlan {
  const plan: SandboxCommitPlan = { start: [], skip: [], unmatched: [] };
  const byKey = new Map((recs ?? []).map((r) => [recommendationMatchKey(r.dimension, r.title), r]));
  const seen = new Set<string>();
  for (const i of appliedItems) {
    const item = roadmap[i];
    if (!item) continue;
    const rec = byKey.get(recommendationMatchKey(item.dimension, item.title));
    if (!rec) {
      plan.unmatched.push(item);
      continue;
    }
    if (seen.has(rec.id)) continue;
    seen.add(rec.id);
    if (rec.status === "open") plan.start.push(rec);
    else plan.skip.push({ rec, status: rec.status });
  }
  return plan;
}

/**
 * The applied items joined to their persisted, still-OPEN recs: `planSandboxCommit(...).start`.
 * Re-committing an in_progress/done/dismissed rec would either no-op or regress it. Empty when
 * tracking is off (recs null) or nothing matches.
 */
export function committableRecs(
  roadmap: LlmRoadmapItem[],
  recs: PersistedRecommendation[] | null | undefined,
  appliedItems: Set<number>,
): PersistedRecommendation[] {
  if (!recs || recs.length === 0) return [];
  return planSandboxCommit(roadmap, recs, appliedItems).start;
}

export const SKIP_LABEL: Record<SkipStatus, string> = {
  in_progress: "in progress",
  done: "done",
  dismissed: "dismissed",
};
const SKIP_ORDER: SkipStatus[] = ["in_progress", "done", "dismissed"];

/** The extent in one line: "Start 1 · 2 already on the tracker (1 in progress, 1 done) · 1 not
 *  tracked for this scan". An empty start keeps the breakdown, so a disabled button says WHICH of
 *  the two facts (already tracked, or not tracked) stopped it. */
export function summarizeSandboxPlan(plan: SandboxCommitPlan): string {
  const parts = [plan.start.length > 0 ? `Start ${plan.start.length}` : "Nothing new to start"];
  if (plan.skip.length > 0) {
    const by = SKIP_ORDER.map((s) => [s, plan.skip.filter((k) => k.status === s).length] as const)
      .filter(([, n]) => n > 0)
      .map(([s, n]) => `${n} ${SKIP_LABEL[s]}`);
    parts.push(`${plan.skip.length} already on the tracker (${by.join(", ")})`);
  }
  if (plan.unmatched.length > 0) parts.push(`${plan.unmatched.length} not tracked for this scan`);
  return parts.join(" · ");
}

/**
 * The permanent event-trail note stamped on every rec a sandbox commit claims. The rounded
 * projection carries its own sign (a modeled regression is never floored to "+0"), and a projection
 * that rounds to zero omits the figure rather than emitting a number that measures nothing.
 */
export function sandboxCommitNote(projectedDelta: number): string {
  const pts = Math.round(projectedDelta);
  if (pts > 0) return `Committed from sandbox simulation, projected +${pts} pts overall.`;
  if (pts < 0) return `Committed from sandbox simulation, projected ${pts} pts overall.`;
  return "Committed from sandbox simulation, no projected gain to the overall score.";
}

/** N of M, with any shortfall named and what to do about it (the un-committed rows stayed open, so
 *  committing again retries exactly them). */
export function sandboxCommitSummary(saved: number, total: number): string {
  if (total === 0) return "Nothing new to commit.";
  const head = `${saved} of ${total} recommendation${total > 1 ? "s" : ""} marked in progress.`;
  const failed = total - saved;
  if (failed > 0) {
    return `${head} ${failed} couldn’t be saved and stayed open: commit again to retry ${failed > 1 ? "them" : "it"}.`;
  }
  return head;
}

export type CommitOutcome = "tracked" | "held" | "not-open" | "failed";

export interface CommitOutcomeRow {
  id: string;
  title: string;
  outcome: CommitOutcome;
}

export interface HandoffResponse {
  marked: string[];
  skipped: { id: string; reason: string }[];
}

/** Each started row's outcome from the hand-off response. A start id the server named in neither
 *  list did not land: it is `failed`, never silently counted as saved. */
export function commitOutcomeRows(plan: SandboxCommitPlan, res: HandoffResponse): CommitOutcomeRow[] {
  const marked = new Set(res.marked);
  const skipped = new Map(res.skipped.map((s) => [s.id, s.reason]));
  return plan.start.map((rec) => {
    const reason = skipped.get(rec.id);
    const outcome: CommitOutcome = marked.has(rec.id)
      ? "tracked"
      : reason === "held" || reason === "not-open"
        ? reason
        : "failed";
    return { id: rec.id, title: rec.title, outcome };
  });
}

export const OUTCOME_LABEL: Record<CommitOutcome, string> = {
  tracked: "tracked",
  held: "held by someone else",
  "not-open": "no longer open",
  failed: "failed",
};

/** The commit summary, built from the rows: held / closed-meanwhile and failed are different facts
 *  (only a failed row is still open and worth retrying). */
export function summarizeCommitOutcome(rows: CommitOutcomeRow[]): string {
  const n = (o: CommitOutcome) => rows.filter((r) => r.outcome === o).length;
  if (rows.length === 0) return sandboxCommitSummary(0, 0);
  const parts = [`${n("tracked")} of ${rows.length} recommendation${rows.length > 1 ? "s" : ""} marked in progress.`];
  if (n("held") > 0) parts.push(`${n("held")} already taken by someone else.`);
  if (n("not-open") > 0) parts.push(`${n("not-open")} closed since this report loaded.`);
  const failed = n("failed");
  if (failed > 0) {
    parts.push(`${failed} couldn't be saved and stayed open: commit again to retry ${failed > 1 ? "them" : "it"}.`);
  }
  return parts.join(" ");
}
