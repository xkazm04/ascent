"use client";

// Sandbox -> tracker bridge (roadmap-recommendation-tracking #6/D6). The Roadmap Sandbox models the
// cheapest path to the next level with real engine math; this bar persists the sandbox's APPLIED
// roadmap items (the ones the user clicked "Try it" on) as `in_progress` recommendations.
//
// Since roadmap-1 it writes ONCE, through THE ONE CLAIM PATH: a single POST to
// /api/org/followups/handoff with `origin: "sandbox"`, which resolves the org from the rows, claims
// them as an unleased human claim (`claimFollowups`) and stamps the signed sandbox note. It used to
// loop status-only PATCHes, so a committed row read "in progress" with nobody holding it on the
// Follow-ups ledger. The bar previews its extent before writing (start / skip with status /
// untracked) and reports per row after (tracked / held / no longer open / failed). The pure half
// lives in sandboxCommitModel.ts and is re-exported here so existing imports keep working.
//
// No transition consequences fire client-side: open -> in_progress plans none
// (src/lib/report/rec-transitions.ts), which is why the claim door does not run them either.

import { useState } from "react";
import type { LlmRoadmapItem, PersistedRecommendation } from "@/lib/types";
import { Kicker } from "@/components/ui";
import {
  commitOutcomeRows,
  planSandboxCommit,
  summarizeCommitOutcome,
  summarizeSandboxPlan,
  type CommitOutcomeRow,
  type HandoffResponse,
} from "@/components/report/sandboxCommitModel";
import { SandboxCommitOutcome, SandboxCommitPreview } from "@/components/report/SandboxCommitPreview";

export { committableRecs, sandboxCommitNote, sandboxCommitSummary } from "@/components/report/sandboxCommitModel";

type CommitState =
  | { kind: "idle" }
  | { kind: "saving"; total: number }
  | { kind: "done"; rows: CommitOutcomeRow[] }
  /** 403 (read-only public funnel) or 503 (no DB): non-retryable, the button stays off. */
  | { kind: "blocked"; message: string };

const BLOCKED_403 = "Committing is available for your own organization's scans; this is a read-only public report.";
const BLOCKED_503 = "Progress tracking isn't available here: it needs a connected database.";

export function SandboxCommitBar({
  roadmap,
  recs,
  appliedItems,
  projectedDelta,
  onRecommendationCommitted,
}: {
  roadmap: LlmRoadmapItem[];
  recs: PersistedRecommendation[] | null | undefined;
  appliedItems: Set<number>;
  /** The sandbox's projected overall-score delta vs today, stamped into the event-trail note. */
  projectedDelta: number;
  onRecommendationCommitted?: (rec: PersistedRecommendation) => void;
}) {
  const [state, setState] = useState<CommitState>({ kind: "idle" });
  const plan = planSandboxCommit(roadmap, recs, appliedItems);
  const n = plan.start.length;

  // Why the button is off, spelled out on hover. An empty start names the breakdown (already on the
  // tracker, by status, vs not tracked for this scan) instead of one sentence conflating the two.
  const disabledTitle = !recs
    ? "Committing needs a connected database and your own organization's scan (model here, commit from a tracked report)."
    : appliedItems.size === 0
      ? "Try a recommendation above first, then commit the ones you want to track."
      : n === 0
        ? summarizeSandboxPlan(plan)
        : undefined;

  async function commit() {
    if (n === 0 || state.kind === "saving" || state.kind === "blocked") return;
    const snapshot = plan;
    setState({ kind: "saving", total: n });
    let body: HandoffResponse = { marked: [], skipped: [] };
    try {
      const res = await fetch("/api/org/followups/handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: snapshot.start.map((r) => r.id), origin: "sandbox", projectedDelta }),
      });
      if (res.status === 403 || res.status === 503) {
        setState({ kind: "blocked", message: res.status === 403 ? BLOCKED_403 : BLOCKED_503 });
        return;
      }
      if (res.ok) {
        const json = (await res.json().catch(() => null)) as Partial<HandoffResponse> | null;
        body = {
          marked: Array.isArray(json?.marked) ? json.marked : [],
          skipped: Array.isArray(json?.skipped) ? json.skipped : [],
        };
      }
    } catch {
      // A network failure leaves `body` empty: every started row reads `failed`, by name.
    }
    const rows = commitOutcomeRows(snapshot, body);
    const marked = new Set(rows.filter((r) => r.outcome === "tracked").map((r) => r.id));
    for (const rec of snapshot.start) {
      if (marked.has(rec.id)) onRecommendationCommitted?.({ ...rec, status: "in_progress" });
    }
    setState({ kind: "done", rows });
  }

  const anyShort = state.kind === "done" && state.rows.some((r) => r.outcome !== "tracked");

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-divider bg-slate-950/30 p-4">
      <div className="min-w-0">
        <Kicker tone="accent">Commit plan</Kicker>
        <p className="mt-1 max-w-prose type-body-sm leading-relaxed text-slate-400">
          Persist the recommendations you tried as <span className="text-slate-200">in progress</span> on the
          tracker: your modeled path, saved instead of lost on close.
        </p>
        {recs && state.kind !== "done" && state.kind !== "blocked" && <SandboxCommitPreview plan={plan} />}
        {/* Polite live region so the commit outcome is announced without stealing focus. */}
        <div role="status" aria-live="polite">
          {state.kind === "done" && (
            <>
              <p className={`mt-1 type-body-sm ${anyShort ? "text-amber-200/90" : "text-emerald-300"}`}>
                {summarizeCommitOutcome(state.rows)}
              </p>
              <SandboxCommitOutcome rows={state.rows} />
            </>
          )}
          {state.kind === "blocked" && (
            <p className="mt-1 flex items-center gap-1.5 type-body-sm text-amber-200/90">
              <span aria-hidden>ⓘ</span>
              {state.message}
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={commit}
        disabled={n === 0 || state.kind === "saving" || state.kind === "blocked"}
        title={disabledTitle}
        className="shrink-0 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 type-body-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state.kind === "saving"
          ? `Committing ${state.total}…`
          : n > 0
            ? `Commit ${n} to tracker →`
            : "Commit to tracker"}
      </button>
    </div>
  );
}
