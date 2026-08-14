"use client";

import { useState } from "react";
import type { PersistedRecommendation, RecStatus, ScanReport } from "@/lib/types";
import { ExemplarPointer, ExploreList, PayoffChip, RoadmapMeta } from "@/components/report/roadmapPieces";
import { isQuickWin, priorityScore, QuickWinBadge } from "@/components/report/roadmapPriority";
import { applyOptimisticStatus, rollbackRowStatus } from "@/components/report/recommendationRowState";
import { STATUS_LABEL, STATUS_ACCENT } from "@/components/org/shared/backlogShared";
import { StatusSelect, useSavingIds } from "@/components/org/shared/recStatusUi";
import { Surface } from "@/components/ui";
import {
  DismissReasonPrompt,
  DoneReconciliation,
  RowErrorNotice,
  RowSpinner,
  type RowError,
} from "@/components/report/recommendationRowUi";
import { OrphanedTracking } from "@/components/report/OrphanedTracking";

export function RecommendationTracker({
  items: initial,
  report,
  prevDimScores = null,
}: {
  items: PersistedRecommendation[];
  report: ScanReport;
  /** Per-dimension scores from the PREVIOUS scan, for the done-row reconciliation. `null` (no prior
   *  scan, or history failed to load) correctly yields "not re-measured", never "didn't move". */
  prevDimScores?: Map<string, number> | null;
}) {
  // This scan's per-dimension scores — the `after` side of every done row's reconciliation.
  const dimScores = new Map(report.dimensions?.map((d) => [d.id, d.score]) ?? []);
  const [items, setItems] = useState(initial);
  // Per-id saving set (not a single shared string) so overlapping in-flight PATCHes each
  // disable only their own row instead of one freezing/clobbering another.
  const { savingIds, errors, setSaving, setError, clearError } = useSavingIds<RowError>();
  // Per-id announcement (not one shared string feeding a single live region): a single scalar meant
  // two rows resolving close together overwrote each other before the screen reader voiced the first
  // (and identical strings never re-announce), silently dropping a save success/failure for AT users.
  // Each row now owns its own role="status" region so overlapping saves are announced independently.
  const [announcements, setAnnouncements] = useState<Record<string, string>>({});
  const announce = (id: string, msg: string) => setAnnouncements((a) => ({ ...a, [id]: msg }));
  // The row whose "dismissed" pick is waiting on a reason. A dismissal is the one moment a team
  // volunteers the context the next scan lacks, so the PATCH is deferred until they answer (or
  // explicitly skip) — see recommendationRowUi.DismissReasonPrompt.
  const [pendingDismiss, setPendingDismiss] = useState<string | null>(null);

  // Repo ref for the concurrent-edit (409) refetch below — re-seeds a row from the server before Retry.
  const repoRef = `${report.repo.owner}/${report.repo.name}`;

  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const dismissed = items.filter((i) => i.status === "dismissed").length;
  // Progress is measured against the ACTIONABLE set (everything not dismissed). Keeping dismissed
  // items in the denominator left a fully-triaged backlog (e.g. 3 done + 2 dismissed) stuck below
  // 100% forever, so a completed backlog read as perpetually incomplete.
  const actionable = total - dismissed;
  // All-dismissed is NOT success: with the dismissed-excluding divisor, actionable === 0 used to fall
  // back to 100 and a team that rejected EVERY recommendation saw "0 of 0 done" beside a full green
  // bar (roadmap-recommendation-tracking 07-16 #5). Render a neutral "all dismissed" header + muted
  // bar for that corner; the 100 fallback stays only for the impossible empty-list case (the parent
  // gates on recs.length > 0).
  const allDismissed = actionable === 0 && dismissed > 0;
  const pct = actionable ? Math.round((done / actionable) * 100) : 100;

  // Render in the SAME quick-wins-first priority order as the public RoadmapSteps view. The server
  // returns rows in createdAt order (whatever order the LLM emitted them), and rendering that raw
  // order meant enabling persistence silently destroyed the roadmap's prioritization + numbering
  // (roadmap-recommendation-tracking #2). The sort key (impact/effort) never changes on a status
  // update, so rows keep stable positions while the user triages.
  const ordered = [...items].sort((a, b) => priorityScore(b) - priorityScore(a));

  /** After a concurrent-edit 409, pull this row's current server value and re-seed it locally so the
   *  displayed status — and the Retry — rebase on the latest state instead of the user's stale
   *  pre-image (which would just conflict again). Best-effort: on failure the error + Retry remain.
   *
   *  The list endpoint returns the repo's MOST RECENT scan's recommendations, while this tracker's
   *  rows belong to the scan loaded with the page. When a newer scan has landed since page load
   *  (a teammate rescanned), this row's id is absent from the response — that is NOT "refresh
   *  failed", it means the whole report is superseded and Retry would 409 forever
   *  (roadmap-recommendation-tracking 07-16 #3). Report it as "missing" so the caller can show a
   *  non-retryable "reload the page" error instead of the misleading retry loop. */
  async function refreshRow(id: string): Promise<"refreshed" | "missing" | "failed"> {
    try {
      const res = await fetch(`/api/recommendations?repo=${encodeURIComponent(repoRef)}`);
      if (!res.ok) return "failed";
      const data = (await res.json().catch(() => null)) as { items?: PersistedRecommendation[] } | null;
      if (!data?.items) return "failed";
      const fresh = data.items.find((i) => i.id === id);
      if (!fresh?.status) return "missing";
      setItems((cur) => applyOptimisticStatus(cur, id, fresh.status));
      return "refreshed";
    } catch {
      // Network error while refreshing — leave the rolled-back row as-is; the transient error offers Retry.
      return "failed";
    }
  }

  /** The <select>'s entry point. Every status but `dismissed` saves immediately; `dismissed` opens
   *  the reason prompt first, because the reason is the whole value of the transition. */
  function pickStatus(id: string, status: RecStatus) {
    if (status === "dismissed") {
      clearError(id);
      setPendingDismiss(id);
      return;
    }
    setPendingDismiss((cur) => (cur === id ? null : cur));
    void setStatus(id, status);
  }

  async function setStatus(id: string, status: RecStatus, reason?: string) {
    // Re-entrancy guard: ignore a change fired while this row's save is still in flight. The status
    // <select> is no longer `disabled` during a save (disabling the focused control blurred it, dropping
    // keyboard/SR focus to <body> — roadmap-recommendation-tracking #2), so this guard is now what
    // prevents a second overlapping PATCH on the same row.
    if (savingIds.has(id)) return;
    const row = items.find((i) => i.id === id);
    const title = row?.title ?? "Recommendation";
    // Capture ONLY this row's prior status for a targeted rollback. Reverting to a whole-list
    // snapshot (the old `setItems(prev)`) would clobber other rows' concurrent optimistic or
    // already-confirmed changes when several updates overlap.
    const priorStatus = row?.status;
    const rollback = () => setItems((cur) => rollbackRowStatus(cur, id, priorStatus));

    setSaving(id, true);
    clearError(id);
    setItems((cur) => applyOptimisticStatus(cur, id, status)); // optimistic, this row only
    try {
      const res = await fetch(`/api/recommendations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // The dismissal reason rides the existing `note` contract — the API turns it into a standing
        // decision the next scan's prompt reads. Absent/empty ⇒ no note, and no suppression.
        body: JSON.stringify(reason ? { status, note: reason } : { status }),
      });
      if (!res.ok) {
        // Distinguish "tracking simply isn't available" (503 — no DB) from a transient failure,
        // so the message is honest and only retryable errors offer a Retry.
        const kind: RowError["kind"] = res.status === 503 ? "config" : "transient";
        const message =
          kind === "config"
            ? "Progress tracking isn’t available here: it needs a connected database, so this change can’t be saved."
            : res.status === 409
              ? "This recommendation changed elsewhere. Showing the latest. Retry to reapply your change."
              : "Couldn’t save that change. Check your connection and retry.";
        rollback(); // revert ONLY this row
        // A 409 means a concurrent edit landed since this row loaded; pull the current server value and
        // re-seed the row so the display (and a Retry) rebase on the latest, instead of resubmitting the
        // same stale change that just conflicts again. When the refetch shows this row no longer EXISTS
        // in the latest scan (a newer scan superseded this page), a Retry would 409 deterministically —
        // swap the retryable message for a non-retryable "reload" one (#3).
        if (res.status === 409 && (await refreshRow(id)) === "missing") {
          const staleMessage =
            "A newer scan has replaced this report. Reload the page to pick up the latest recommendations.";
          setError(id, { status, kind: "stale", message: staleMessage, reason });
          announce(id, `Couldn’t update “${title}”: ${staleMessage}`);
          return;
        }
        setError(id, { status, kind, message, reason });
        announce(id, `Couldn’t update “${title}”: ${message}`);
        return;
      }
      // Reconcile from the authoritative server row so the displayed status + the done/total count
      // track what was actually stored (a server normalization or a concurrent change), not just what
      // we optimistically sent. Was: keep the optimistic value + discard the response.
      const saved = (await res.json().catch(() => null)) as PersistedRecommendation | null;
      if (saved?.status) setItems((cur) => applyOptimisticStatus(cur, id, saved.status));
      announce(id, `“${title}” marked ${STATUS_LABEL[status]}.`);
    } catch {
      rollback();
      setError(id, { status, kind: "transient", message: "Couldn’t save that change. Check your connection and retry.", reason });
      announce(id, `Couldn’t update “${title}”: network error.`);
    } finally {
      setSaving(id, false);
    }
  }

  return (
    <div className="space-y-3">
      <Surface radius="xl" className="p-4">
        <div className="flex items-center justify-between text-base">
          {allDismissed ? (
            <span className="font-medium text-slate-400">
              All {dismissed} recommendation{dismissed === 1 ? "" : "s"} dismissed, nothing left to track
            </span>
          ) : (
            <>
              <span className="font-medium text-white">
                {done} of {actionable} done
                {dismissed > 0 && <span className="text-slate-500"> · {dismissed} dismissed</span>}
              </span>
              <span className="text-slate-400">{pct}%</span>
            </>
          )}
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
          {/* No triumphant success gradient when nothing was actually done — a muted neutral fill. */}
          {allDismissed ? (
            <div className="h-full rounded-full bg-slate-700" style={{ width: "100%" }} />
          ) : (
            <div className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          )}
        </div>
      </Surface>

      {/* Tracking the last re-scan couldn't carry forward — named and re-linkable, never silently
          reset. Renders nothing when there is none. */}
      <OrphanedTracking
        repoRef={repoRef}
        items={items}
        onApplied={(rec) => setItems((cur) => cur.map((i) => (i.id === rec.id ? { ...i, ...rec } : i)))}
      />

      {ordered.map((item, i) => {
        const muted = item.status === "done" || item.status === "dismissed";
        const err = errors[item.id];
        const saving = savingIds.has(item.id);
        // Non-retryable kinds (config, stale) render informational amber; only transient is red+Retry.
        const edge = err ? (err.kind === "transient" ? "#ef4444" : "#eab308") : STATUS_ACCENT[item.status];
        return (
          <div
            key={item.id}
            aria-busy={saving}
            className="rounded-xl border bg-surface/40 p-5"
            style={{ borderLeftWidth: 3, borderLeftColor: edge }}
          >
            {/* Per-row polite live region — each save's success/failure is announced independently,
                so overlapping saves on other rows can't clobber this one's message. */}
            <div role="status" aria-live="polite" className="sr-only">
              {announcements[item.id] ?? ""}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Priority number + quick-win badge mirror RoadmapSteps, so the persisted tracker keeps
                  the public roadmap's "do these first" signaling (roadmap-recommendation-tracking #2).
                  min-w-0 lets the title shrink; break-words then wraps a long unbroken rec title
                  instead of overflowing the row (a rec title is descriptive text — wrap, don't clip). */}
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-700 font-mono text-sm text-slate-300">
                  {i + 1}
                </span>
                <h3 className={`min-w-0 break-words font-semibold ${muted ? "text-slate-400 line-through decoration-slate-600" : "text-white"}`}>
                  {item.title}
                </h3>
                {isQuickWin(item) && !muted && <QuickWinBadge />}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <RoadmapMeta item={item} />
                <PayoffChip report={report} dim={item.dimension} />
                {saving && <RowSpinner />}
                <StatusSelect
                  value={item.status}
                  busy={saving}
                  onChange={(status) => pickStatus(item.id, status)}
                  // A pick made WHILE this row is saving is dropped and the select snaps back with no
                  // visual cue (the spinner is aria-hidden) — announce the swallow through this row's
                  // live region so the user knows to re-pick once the save settles (#4 07-16).
                  onBusyChange={() =>
                    announce(item.id, "Still saving the previous change. Pick the status again in a moment.")
                  }
                  aria-label="Recommendation status"
                />
              </div>
            </div>
            {item.rationale && <p className="mt-2 text-base leading-relaxed text-slate-400">{item.rationale}</p>}
            {item.status === "done" && (
              <DoneReconciliation
                dimension={item.dimension}
                prevScore={prevDimScores?.get(item.dimension)}
                currentScore={dimScores.get(item.dimension)}
              />
            )}
            {!muted && <ExploreList items={item.explore} />}
            {!muted && <ExemplarPointer dim={item.dimension} />}
            {pendingDismiss === item.id && (
              <DismissReasonPrompt
                onConfirm={(reason) => {
                  setPendingDismiss(null);
                  void setStatus(item.id, "dismissed", reason || undefined);
                }}
                onCancel={() => setPendingDismiss(null)}
              />
            )}
            {err && (
              <RowErrorNotice
                err={err}
                saving={saving}
                onRetry={() => setStatus(item.id, err.status, err.reason)}
                onDismiss={() => clearError(item.id)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
