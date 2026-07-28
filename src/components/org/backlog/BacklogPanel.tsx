"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/org/shared/ui";
import type { BacklogItem, BacklogDueGroup, OrgBacklog } from "@/lib/db";
import { OwnerHeader, SummaryStrip } from "@/components/org/backlog/BacklogSummary";
import { BacklogItemRow, type BacklogRowState } from "@/components/org/backlog/BacklogItemRow";
import { useSavingIds } from "@/components/org/shared/recStatusUi";
import type { PatchOutcome } from "@/components/org/shared/backlogShared";
import { BacklogUndoBar, BacklogViewControls, type BacklogUndo } from "@/components/org/backlog/BacklogPanel.controls";
import type { RecStatus } from "@/lib/types";
// Impact-word tiebreak ranking for the "Projected points" cross-repo sort (canonical map).
import { IMPACT_RANK } from "@/lib/scoring/impact";

/**
 * The org-wide recommendation backlog: a stat strip, a By owner / By due date toggle, and inline
 * controls to set each item's status, owner, and due date. Every change PATCHes the recommendation
 * (recording an activity-timeline event) and re-reads the backlog so the groupings and counts stay
 * consistent. Each item exposes its history on demand.
 */
export function BacklogPanel({
  slug,
  initial,
  segmentId = null,
  techGroupId = null,
}: {
  slug: string;
  initial: OrgBacklog;
  /** The page's resolved segment/tech-group scope — threaded into every refresh so a post-edit
   *  re-read stays on the filtered view instead of snapping back to the whole org (backlog #2 07-16). */
  segmentId?: string | null;
  techGroupId?: string | null;
}) {
  const [backlog, setBacklog] = useState<OrgBacklog>(initial);
  const [view, setView] = useState<"owner" | "due" | "points">("owner");
  // G6-02 (reversibility). Two affordances, no confirm dialog:
  //  1. `undo` — the last completed change to a terminal status, offered back for one click. The row is
  //     already gone from the list by then, so the affordance has to live HERE, in the panel.
  //  2. `showClosed` — re-reads the backlog with done/dismissed rows included, so an item dismissed
  //     long ago (past the undo bar) is still findable and can be set back to Open.
  const [showClosed, setShowClosed] = useState(false);
  const [undo, setUndo] = useState<BacklogUndo | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const { savingIds, errors, setSaving, setError, clearError } = useSavingIds<string>();
  // Volatile per-row state (PR result, expanded history, promote flag) lifted out of BacklogItemRow and
  // keyed by item id, so it SURVIVES the remount that happens when an edit re-groups a row into a
  // different owner/due Card. Keeping it in the row dropped the just-opened PR link on a routine edit
  // (backlog-management #2).
  const [rowStates, setRowStates] = useState<Record<string, BacklogRowState>>({});
  const setRowState = useCallback(
    (id: string, patch: BacklogRowState) => setRowStates((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } })),
    [],
  );
  // Monotonic token so only the LATEST refresh's response is applied. Each edit triggers a full
  // server re-read that wholesale-replaces the backlog; without sequencing, a slower-arriving OLDER
  // snapshot can clobber a newer one when two items are edited in quick succession (lost edit).
  const refreshSeq = useRef(0);

  // backlog-management #3: an inline owner/due edit re-groups its row into a different Card, which
  // UNMOUNTS+remounts the row and strands keyboard/SR focus on <body>. A row records the control it's
  // editing here (`${id}:field`); once the refresh re-renders the (possibly moved) row, the effect
  // below restores focus to that control by its stable `data-focus-key`. The parent never remounts, so
  // it's the reliable place to own this. React 19 batches the refresh's setBacklog with the save-flag
  // clear into one commit, so the restored control is already re-enabled when we focus it.
  const pendingFocus = useRef<string | null>(null);
  const onEditField = useCallback((key: string) => {
    pendingFocus.current = key;
  }, []);
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
  }, [backlog]);

  // Returns whether a fresh authoritative snapshot was actually applied, so a caller can tell "the
  // server view is now current" from "the refresh was swallowed" (backlog #2).
  const refresh = useCallback(async (): Promise<boolean> => {
    const seq = ++refreshSeq.current;
    const qs = new URLSearchParams({ org: slug });
    if (segmentId) qs.set("segment", segmentId);
    if (techGroupId) qs.set("techGroup", techGroupId);
    if (showClosed) qs.set("includeClosed", "1");
    const res = await fetch(`/api/org/backlog?${qs}`);
    if (!res.ok) return false;
    const data = (await res.json()) as { backlog: OrgBacklog | null };
    // Drop a stale response: a later edit's refresh has already superseded this one, so applying this
    // older snapshot would revert the newer edit. Only the most-recent refresh wins.
    if (seq !== refreshSeq.current) return false;
    if (!data.backlog) return false;
    setBacklog(data.backlog);
    return true;
  }, [slug, segmentId, techGroupId, showClosed]);

  // Re-read when the closed-items toggle flips (the scope of the query changed, not just the view).
  // Skipped on mount so the server-rendered `initial` snapshot isn't immediately refetched.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    void refresh();
  }, [showClosed, refresh]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>): Promise<PatchOutcome> => {
      setSaving(id, true);
      clearError(id);
      // Capture the pre-change status/title from the CURRENT snapshot so a terminal change can be
      // offered back exactly (see `undo` above). Read before the write; the refresh replaces `backlog`.
      const before = backlog.byOwner.flatMap((g) => g.items).find((i) => i.id === id);
      const next = body.status;
      const terminal = next === "done" || next === "dismissed";
      try {
        const res = await fetch(`/api/recommendations/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const msg = (await res.json().catch(() => ({})))?.error ?? "Couldn’t save that change.";
          setError(id, msg);
          // On a 409 optimistic-lock conflict, pull the authoritative current state so the user sees
          // what actually persisted (and the reverted control reflects it) before retrying.
          const refreshed = res.status === 409 ? await refresh() : false;
          return { patched: false, refreshed };
        }
        // Only a SUCCEEDED terminal change gets an undo offer — offering to undo a rejected patch
        // would misreport what the server holds.
        if (terminal && before) {
          setUndo({ id, title: before.title, from: before.status as RecStatus, to: next as RecStatus });
        }
        const refreshed = await refresh();
        return { patched: true, refreshed };
      } catch {
        setError(id, "Network error — check your connection and retry.");
        return { patched: false, refreshed: false };
      } finally {
        setSaving(id, false);
      }
    },
    [refresh, setSaving, setError, clearError, backlog],
  );

  // Put the item back where it was. Restoring `from` (not a hardcoded "open") means undoing a
  // Done on an in-progress item returns it to In progress, and the timeline records the reversal as a
  // normal status event — the audit trail stays truthful about both changes.
  const runUndo = useCallback(async () => {
    if (!undo || undoBusy) return;
    setUndoBusy(true);
    const outcome = await patch(undo.id, { status: undo.from });
    setUndoBusy(false);
    // Keep the bar up on failure: the row is still closed, so this is still the only way back.
    if (outcome.patched) setUndo(null);
  }, [undo, undoBusy, patch]);

  const groups: { key: string; header: React.ReactNode; items: BacklogItem[] }[] =
    view === "owner"
      ? backlog.byOwner.map((g) => ({ key: g.login ?? "__unassigned", header: <OwnerHeader group={g} />, items: g.items }))
      : view === "due"
        ? backlog.byDue.map((g: BacklogDueGroup) => ({
            key: g.bucket,
            header: (
              <span className={`text-base font-semibold ${g.bucket === "overdue" ? "text-orange-300" : "text-white"}`}>
                {g.label} <span className="font-mono text-sm text-slate-500">· {g.items.length}</span>
              </span>
            ),
            items: g.items,
          }))
        : [
            {
              key: "__points",
              header: (
                <span className="text-base font-semibold text-white">
                  Highest projected gain first{" "}
                  <span className="font-mono text-sm text-slate-500">
                    · engine points if the gap is fully closed
                  </span>
                </span>
              ),
              // "Projected points" is a flat cross-repo ranking on the engine-true ROI each item
              // carries (projectedPoints — overall-score upside of closing the gap), so cross-repo
              // leverage the per-repo report can't show sorts to the top. Items without a projection
              // (pre-dimension scans) sink below scored ones; impact words break ties. Built lazily
              // here so the cross-repo sort only runs when this view is actually selected.
              items: backlog.byOwner
                .flatMap((g) => g.items)
                .sort(
                  (a, b) =>
                    (b.projectedPoints ?? -1) - (a.projectedPoints ?? -1) ||
                    (IMPACT_RANK[b.impact] ?? 0) - (IMPACT_RANK[a.impact] ?? 0) ||
                    b.lastActivityAt.localeCompare(a.lastActivityAt),
                ),
            },
          ];

  return (
    <div className="space-y-5">
      <SummaryStrip b={backlog} />

      <BacklogViewControls
        view={view}
        onView={setView}
        showClosed={showClosed}
        onToggleClosed={() => setShowClosed((v) => !v)}
        closedCount={backlog.done + backlog.dismissed}
      />

      {undo && (
        <BacklogUndoBar undo={undo} busy={undoBusy} onUndo={() => void runUndo()} onDismiss={() => setUndo(null)} />
      )}

      {groups.length === 0 ? (
        <Card>
          <p className="text-base text-slate-500">
            {showClosed
              ? "No recommendations at all — nothing has been tracked for this scope yet."
              : "Nothing active in the backlog — every recommendation is done or dismissed. 🎉"}
          </p>
          {/* Never a terminal dead end: name the route to the closed items even from the empty state. */}
          {!showClosed && backlog.done + backlog.dismissed > 0 && (
            <p className="mt-1 text-sm text-slate-500">
              Use “Show done &amp; dismissed” above to review or restore the{" "}
              {backlog.done + backlog.dismissed} closed item{backlog.done + backlog.dismissed === 1 ? "" : "s"}.
            </p>
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.key}>
              <div className="mb-3">{g.header}</div>
              <div className="space-y-3">
                {g.items.map((item) => (
                  <BacklogItemRow
                    key={item.id}
                    org={slug}
                    item={item}
                    assignees={backlog.assignees}
                    saving={savingIds.has(item.id)}
                    error={errors[item.id]}
                    state={rowStates[item.id]}
                    onState={(patch) => setRowState(item.id, patch)}
                    onPatch={patch}
                    onEditField={onEditField}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
