"use client";

// State + handlers for the Backlog panel (BacklogPanel.tsx) — extracted per the extraction order in
// docs/ORG-TABS-REFACTOR.md §3 (state/effects/handlers → use<Feature><Thing>.ts, owns no JSX) so the
// component file stays JSX + wiring only, under the 200-LOC cap.
//
// Owns: the fetched backlog snapshot + refresh/patch/undo, the view toggle, the client-side filter,
// row-state lifted out of BacklogItemRow (survives regroup remounts), bulk selection, and the
// pending-focus restoration after an edit re-groups a row into a different owner/due Card.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OrgBacklog } from "@/lib/db";
import type { BacklogRowState } from "@/components/org/plan/backlog/BacklogItemRow";
import { useSavingIds } from "@/components/org/shared/recStatusUi";
import type { PatchOutcome } from "@/components/org/shared/backlogShared";
import type { BacklogUndo } from "@/components/org/plan/backlog/BacklogPanelControls";
import type { BacklogView } from "@/components/org/plan/backlog/BacklogGroups";
import { MAX_BULK, useBacklogBulk } from "@/components/org/plan/backlog/useBacklogBulk";
import {
  EMPTY_BACKLOG_FILTER,
  backlogItemIds,
  backlogOwnerOptions,
  filterBacklog,
  filterWantsClosed,
  type BacklogFilter,
} from "@/components/org/plan/backlog/backlogFilter";
import type { RecStatus } from "@/lib/types";

export function useBacklogPanel({
  slug,
  initial,
  segmentId = null,
  techGroupId = null,
}: {
  slug: string;
  initial: OrgBacklog;
  segmentId?: string | null;
  techGroupId?: string | null;
}) {
  const [backlog, setBacklog] = useState<OrgBacklog>(initial);
  const [view, setView] = useState<BacklogView>("owner");
  // G7-12. Search/status/owner filtering is a CLIENT narrowing of the fetched snapshot; only the
  // closed-status chips change the FETCH, by forcing `showClosed` on (see setFilter below), so the
  // filter composes with the recovery toggle instead of shadowing it.
  const [filter, setFilter] = useState<BacklogFilter>(EMPTY_BACKLOG_FILTER);
  const [rawSelected, setSelected] = useState<Set<string>>(() => new Set());
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

  const { bulk, runBulk, resetBulk } = useBacklogBulk(refresh);

  // G7-13: the CSV download mirrors the CURRENT read scope exactly (segment, tech group, and whether
  // closed rows are included), so an export can't quietly carry rows the screen isn't showing. The
  // client-side text/status/owner filter is deliberately NOT encoded — it's a view over the fetch, and
  // the route is the one place the scope is authorized.
  const exportHref = useMemo(() => {
    const qs = new URLSearchParams({ org: slug, format: "csv" });
    if (segmentId) qs.set("segment", segmentId);
    if (techGroupId) qs.set("techGroup", techGroupId);
    if (showClosed) qs.set("includeClosed", "1");
    return `/api/org/backlog?${qs}`;
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
        setError(id, "Network error. Check your connection and retry.");
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

  // The filtered view every list/selection decision reads. Filtering never touches the headline
  // counts (SummaryStrip keeps describing the ACTIVE org backlog), only what's listed.
  const shownBacklog = useMemo(() => filterBacklog(backlog, filter), [backlog, filter]);
  const shownIds = useMemo(() => backlogItemIds(shownBacklog), [shownBacklog]);
  const shownCount = shownIds.length;
  const ownerOptions = useMemo(() => backlogOwnerOptions(backlog), [backlog]);

  // Picking a Done/Dismissed chip forces the closed rows into the FETCH — otherwise the chip filters a
  // payload that never contained them and reads as a broken search.
  const applyFilter = useCallback((next: BacklogFilter) => {
    setFilter(next);
    if (filterWantsClosed(next)) setShowClosed(true);
  }, []);

  // Selection is pruned to what's on screen, so a bulk action can never reach a row the current
  // filter (or the closed toggle) has hidden — "apply to what I can see" is the whole contract.
  // DERIVED, not synced through an effect: an effect would render once with a stale selection
  // (briefly showing a count that includes hidden rows) before correcting itself, and every read
  // below would have to tolerate that window. `rawSelected` may retain ids that scrolled out of the
  // filter; nothing ever reads it directly.
  const selected = useMemo(() => {
    if (rawSelected.size === 0) return rawSelected;
    const visible = new Set(shownIds);
    const next = new Set([...rawSelected].filter((id) => visible.has(id)));
    return next.size === rawSelected.size ? rawSelected : next;
  }, [rawSelected, shownIds]);

  const runStatus = useCallback(
    async (status: RecStatus) => {
      const ids = shownIds.filter((id) => selected.has(id));
      await runBulk(ids, { status });
      setSelected(new Set());
    },
    [shownIds, selected, runBulk],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return {
    backlog, view, setView, filter, showClosed, setShowClosed, undo, setUndo, undoBusy,
    savingIds, errors, rowStates, setRowState, onEditField,
    bulk, resetBulk, exportHref,
    patch, runUndo, shownBacklog, shownIds, shownCount, ownerOptions, applyFilter,
    selected, setSelected, runStatus, toggleSelect,
  };
}

export const BACKLOG_MAX_BULK = MAX_BULK;

