"use client";

// State + handlers for one backlog row (BacklogItemRow.tsx) — extracted per the extraction order in
// docs/ORG-TABS-REFACTOR.md §3 so the component file stays JSX + wiring only, under the 200-LOC cap.

import { useRef, useState } from "react";
import type { RecEvent } from "@/lib/types";
import type { BacklogItem } from "@/lib/db";
import { PRACTICES } from "@/lib/practices";
import type { PatchOutcome } from "@/components/org/shared/backlogShared";
import type { BacklogRowState } from "@/components/org/plan/backlog/BacklogItemRow";

export function useBacklogItemRow({
  org,
  item,
  assignees,
  state,
  onState,
  onPatch,
  onEditField,
}: {
  org: string;
  item: BacklogItem;
  assignees: string[];
  state?: BacklogRowState;
  onState: (patch: BacklogRowState) => void;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<PatchOutcome>;
  onEditField: (focusKey: string) => void;
}) {
  // Persisted-across-remount state lives in the parent (BacklogPanel); only the truly transient
  // in-flight busy flags stay local.
  const history = state?.history ?? null;
  const prResult = state?.prResult ?? null;
  const prError = state?.prError ?? null;
  const promoted = state?.promoted ?? false;
  const [prBusy, setPrBusy] = useState(false);
  const [promoteBusy, setPromoteBusy] = useState(false);
  // "Open draft PR" writes a real branch+commit+PR into item.repo — gate it behind a confirm naming
  // the repo. Local (transient) state: if the row remounts on a regroup mid-confirm, the dialog just
  // closes (the safe default), which is why this doesn't need the parent's lifted state.
  const [confirmingPr, setConfirmingPr] = useState(false);
  // Monotonic token for the history fetch: each open/refresh bumps it; a resolved fetch only writes
  // its result if it is still the latest request. Closing the panel also bumps it, so an in-flight
  // load that resolves after the user collapsed can't re-open it.
  const historyReq = useRef(0);
  // Optimistic override for the inline status/owner/due controls. They're bound to server state
  // (`item.*`) which only updates after the PATCH + full backlog re-read completes, so on a slow save
  // the control snapped back to the old value (reading as "my edit failed") before jumping to the new
  // one. Overriding the edited field locally keeps the chosen value on screen until the refresh lands;
  // clearing it in `finally` then tracks the server again — the new value on success, the unchanged
  // old value on failure (the parent surfaces the error and never mutates `item` on a failed patch).
  const [override, setOverride] = useState<Partial<BacklogItem>>({});
  const shown = { ...item, ...override };

  async function patchField(patch: Partial<Pick<BacklogItem, "status" | "assigneeLogin" | "targetDate">>) {
    // Record which control the user is on so the parent can return focus here after the PATCH's
    // backlog re-read re-groups this row into a different owner/due Card and remounts it — the remount
    // otherwise strands keyboard/SR focus on <body> (backlog-management #3).
    const field = "status" in patch ? "status" : "assigneeLogin" in patch ? "owner" : "due";
    onEditField(`${item.id}:${field}`);
    setOverride((o) => ({ ...o, ...patch }));
    // Route through patchAndRefresh so an open history list also refreshes with the new timeline event
    // (origin's behaviour) while the optimistic override keeps the value on screen until the backlog
    // re-read lands.
    const outcome = await patchAndRefresh(item.id, patch);
    // Drop the override ONLY when the displayed server state is now authoritative: the refresh applied a
    // fresh snapshot (success / 409 reconcile), OR the PATCH failed (revert to the old value the error
    // explains). If the PATCH SUCCEEDED but the refresh was swallowed (503/blip), KEEP the override — the
    // server already has the new value, so snapping back to the stale `item.*` reads as a phantom revert
    // with no error shown (backlog #2).
    if (outcome.refreshed || !outcome.patched) {
      setOverride((o) => {
        const next = { ...o };
        for (const k of Object.keys(patch)) delete next[k as keyof typeof next];
        return next;
      });
    }
  }

  // Promote this gap into a tracked org Initiative (BKLG-2) — reuses /api/org/initiatives with the
  // rec's dimension + repo, so a per-repo backlog row rolls up into the org-level unit of work.
  async function promoteToInitiative() {
    if (promoteBusy || promoted) return;
    setPromoteBusy(true);
    onState({ prError: null });
    try {
      const res = await fetch("/api/org/initiatives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, title: item.title, dimId: item.dimId, repos: [item.repo] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to create initiative.");
      onState({ promoted: true });
    } catch (e) {
      onState({ prError: e instanceof Error ? e.message : "Failed to create initiative." });
    } finally {
      setPromoteBusy(false);
    }
  }

  // This dimension's reusable practice — its leak-free starter is what the draft PR seeds.
  const practice = PRACTICES.find((p) => p.dimId === item.dimId);

  // The current owner may no longer be a tracked contributor — keep them selectable.
  const options = item.assigneeLogin && !assignees.includes(item.assigneeLogin)
    ? [item.assigneeLogin, ...assignees]
    : assignees;

  // Act on the item: open a draft PR seeding the dimension's practice into the repo (reuses the
  // proven /api/practices/apply path), then flip the item to In progress so the backlog reflects it.
  async function openDraftPr() {
    if (!practice || prBusy) return;
    setPrBusy(true);
    onState({ prError: null });
    try {
      const res = await fetch("/api/practices/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: item.repo, practiceId: practice.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to open PR.");
      onState({ prResult: { url: data.url, reused: data.reused } });
      if (item.status === "open") await patchAndRefresh(item.id, { status: "in_progress" });
    } catch (e) {
      onState({ prError: e instanceof Error ? e.message : "Failed to open PR." });
    } finally {
      setPrBusy(false);
    }
  }

  async function loadHistory() {
    const req = (historyReq.current += 1);
    onState({ history: "loading" });
    // Error and empty are DIFFERENT states: a non-2xx or network blip must render as "couldn't load —
    // retry", never as the empty-copy "No changes recorded yet." (a false statement contradicting the
    // page's own "every change is recorded" promise) (backlog-management 07-16 #3).
    try {
      const res = await fetch(`/api/recommendations/${item.id}/events`);
      const next: BacklogRowState["history"] = res.ok ? ((await res.json()) as { events: RecEvent[] }).events : "error";
      // Ignore a stale response — the panel may have been collapsed (or re-opened) since this fetch began.
      if (historyReq.current === req) onState({ history: next });
    } catch {
      if (historyReq.current === req) onState({ history: "error" });
    }
  }

  function toggleHistory() {
    if (history) {
      // Bump the token so any in-flight load can't re-open the panel we're collapsing.
      historyReq.current += 1;
      onState({ history: null });
      return;
    }
    void loadHistory();
  }

  // onPatch records a new timeline event server-side, so an already-open history list goes stale.
  // Wrap the patch to refetch history after a successful edit (and a no-op when it's collapsed).
  // `history` truthy includes the "error" state — retrying via an edit is fine, it just reloads.
  async function patchAndRefresh(id: string, body: Record<string, unknown>): Promise<PatchOutcome> {
    const outcome = await onPatch(id, body);
    if (history) void loadHistory();
    return outcome;
  }

  return {
    shown, history, prResult, prError, promoted, prBusy, promoteBusy, confirmingPr, setConfirmingPr,
    practice, options,
    patchField, promoteToInitiative, openDraftPr, loadHistory, toggleHistory,
  };
}
