"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/org/shared/ui";
import type { BacklogItem, BacklogDueGroup, OrgBacklog } from "@/lib/db";
import { OwnerHeader, SummaryStrip } from "@/components/org/backlog/BacklogSummary";
import { BacklogItemRow, type BacklogRowState } from "@/components/org/backlog/BacklogItemRow";
import { useSavingIds } from "@/components/org/shared/recStatusUi";
import type { PatchOutcome } from "@/components/org/shared/backlogShared";
// Impact-word tiebreak ranking for the "Projected points" cross-repo sort (canonical map).
import { IMPACT_RANK } from "@/lib/scoring/impact";

/**
 * The org-wide recommendation backlog: a stat strip, a By owner / By due date toggle, and inline
 * controls to set each item's status, owner, and due date. Every change PATCHes the recommendation
 * (recording an activity-timeline event) and re-reads the backlog so the groupings and counts stay
 * consistent. Each item exposes its history on demand.
 */
export function BacklogPanel({ slug, initial }: { slug: string; initial: OrgBacklog }) {
  const [backlog, setBacklog] = useState<OrgBacklog>(initial);
  const [view, setView] = useState<"owner" | "due" | "points">("owner");
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
    const res = await fetch(`/api/org/backlog?org=${encodeURIComponent(slug)}`);
    if (!res.ok) return false;
    const data = (await res.json()) as { backlog: OrgBacklog | null };
    // Drop a stale response: a later edit's refresh has already superseded this one, so applying this
    // older snapshot would revert the newer edit. Only the most-recent refresh wins.
    if (seq !== refreshSeq.current) return false;
    if (!data.backlog) return false;
    setBacklog(data.backlog);
    return true;
  }, [slug]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>): Promise<PatchOutcome> => {
      setSaving(id, true);
      clearError(id);
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
        const refreshed = await refresh();
        return { patched: true, refreshed };
      } catch {
        setError(id, "Network error — check your connection and retry.");
        return { patched: false, refreshed: false };
      } finally {
        setSaving(id, false);
      }
    },
    [refresh, setSaving, setError, clearError],
  );

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

      <div role="group" aria-label="Group backlog by" className="flex items-center gap-1 text-sm">
        <span className="mr-1 font-mono text-sm uppercase tracking-widest text-slate-500">Group by</span>
        {(["owner", "due", "points"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`rounded-lg border px-3 py-1.5 font-medium transition ${
              view === v ? "border-accent/50 bg-accent/10 text-white" : "border-slate-700 text-slate-400 hover:text-white"
            }`}
          >
            {v === "owner" ? "Owner" : v === "due" ? "Due date" : "Projected points"}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <Card>
          <p className="text-base text-slate-500">
            Nothing active in the backlog — every recommendation is done or dismissed. 🎉
          </p>
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
