"use client";

import { useState } from "react";
import type { PersistedRecommendation, RecStatus, ScanReport } from "@/lib/types";
import { RoadmapSortToggle, TrackerProgress } from "@/components/report/roadmapPieces";
import { roadmapLiftKey, sortRoadmap, type RoadmapLifts, type RoadmapSortMode } from "@/components/report/roadmapPriority";
import { expectedLiftClause } from "@/lib/outcomes/expected-lift";
import { applyOptimisticStatus, rollbackRowStatus } from "@/components/report/recommendationRowState";
import { STATUS_LABEL } from "@/components/org/shared/backlogShared";
import { useSavingIds } from "@/components/org/shared/recStatusUi";
import { RecommendationRow } from "@/components/report/RecommendationRow";
import type { RowError } from "@/components/report/recommendationRowUi";
import { OrphanedTracking } from "@/components/report/OrphanedTracking";

export function RecommendationTracker({
  items: initial,
  report,
  prevDimScores = null,
  lifts,
}: {
  items: PersistedRecommendation[];
  report: ScanReport;
  /** The org's measured lift map (moonshot #9). Absent = no ledger, and the tracker renders exactly
   *  the list it always did — no clause, no toggle, no reordering. */
  lifts?: RoadmapLifts;
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
  // Measured ordering (moonshot #9) is OPT-IN and never the default: `sortRoadmap(…, "priority")` is
  // byte-identical to the sort this list has always done, and the toggle only appears once at least
  // one row has a publishable basis clause.
  const [sortMode, setSortMode] = useState<RoadmapSortMode>("priority");
  const anyMeasured = items.some((i) => expectedLiftClause(lifts?.get(roadmapLiftKey(i))) !== null);
  const ordered = sortRoadmap(items, lifts, anyMeasured ? sortMode : "priority");

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
      <TrackerProgress done={done} actionable={actionable} dismissed={dismissed} allDismissed={allDismissed} pct={pct} />
      {/* Offered only when the ledger has something to order BY — see RoadmapSortToggle. */}
      {anyMeasured && (
        <div className="flex justify-end">
          <RoadmapSortToggle mode={sortMode} onChange={setSortMode} />
        </div>
      )}

      {/* Tracking the last re-scan couldn't carry forward — named and re-linkable, never silently
          reset. Renders nothing when there is none. */}
      <OrphanedTracking
        repoRef={repoRef}
        items={items}
        onApplied={(rec) => setItems((cur) => cur.map((i) => (i.id === rec.id ? { ...i, ...rec } : i)))}
      />

      {ordered.map((item, i) => (
        <RecommendationRow
          key={item.id}
          item={item}
          index={i}
          report={report}
          lifts={lifts}
          prevScore={prevDimScores?.get(item.dimension)}
          currentScore={dimScores.get(item.dimension)}
          saving={savingIds.has(item.id)}
          err={errors[item.id]}
          announcement={announcements[item.id] ?? ""}
          dismissing={pendingDismiss === item.id}
          onPickStatus={(status) => pickStatus(item.id, status)}
          onBusySwallowed={() =>
            announce(item.id, "Still saving the previous change. Pick the status again in a moment.")
          }
          onConfirmDismiss={(reason) => {
            setPendingDismiss(null);
            void setStatus(item.id, "dismissed", reason || undefined);
          }}
          onCancelDismiss={() => setPendingDismiss(null)}
          onRetry={() => {
            const err = errors[item.id];
            if (err) void setStatus(item.id, err.status, err.reason);
          }}
          onDismissError={() => clearError(item.id)}
        />
      ))}
    </div>
  );
}
