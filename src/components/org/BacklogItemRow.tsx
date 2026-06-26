"use client";

import { useState } from "react";
import { REC_STATUSES, type RecEvent } from "@/lib/types";
import type { BacklogItem } from "@/lib/db";
import { PRACTICES } from "@/lib/practices";
import { EVENT_LABEL, STATUS_ACCENT, STATUS_LABEL, dueLabel, eventValue } from "@/components/org/backlogShared";

/**
 * Volatile per-row interaction state that must survive a regroup. The backlog re-parents rows into a
 * different owner/due `<Card>` on every edit, which unmounts+remounts the row; keeping this state in
 * the row would wipe the just-opened PR link, the expanded history and the promote flag. So it is
 * lifted into BacklogPanel (keyed by item id) and passed back in — see backlog-management #2.
 */
export interface BacklogRowState {
  history?: RecEvent[] | "loading" | null;
  prResult?: { url: string; reused: boolean } | null;
  prError?: string | null;
  promoted?: boolean;
}

export function BacklogItemRow({
  org,
  item,
  assignees,
  saving,
  error,
  state,
  onState,
  onPatch,
}: {
  org: string;
  item: BacklogItem;
  assignees: string[];
  saving: boolean;
  error?: string;
  /** Lifted per-row state (PR result, history, promote flag) that survives a regroup remount. */
  state?: BacklogRowState;
  /** Merge a patch into this row's lifted state in the parent. */
  onState: (patch: BacklogRowState) => void;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  // Persisted-across-remount state lives in the parent (BacklogPanel); only the truly transient
  // in-flight busy flags stay local.
  const history = state?.history ?? null;
  const prResult = state?.prResult ?? null;
  const prError = state?.prError ?? null;
  const promoted = state?.promoted ?? false;
  const [prBusy, setPrBusy] = useState(false);
  const [promoteBusy, setPromoteBusy] = useState(false);

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
      if (item.status === "open") await onPatch(item.id, { status: "in_progress" });
    } catch (e) {
      onState({ prError: e instanceof Error ? e.message : "Failed to open PR." });
    } finally {
      setPrBusy(false);
    }
  }

  async function toggleHistory() {
    if (history) {
      onState({ history: null });
      return;
    }
    onState({ history: "loading" });
    try {
      const res = await fetch(`/api/recommendations/${item.id}/events`);
      const data = res.ok ? ((await res.json()) as { events: RecEvent[] }) : { events: [] };
      onState({ history: data.events });
    } catch {
      onState({ history: [] });
    }
  }

  const due = dueLabel(item);

  return (
    <div
      aria-busy={saving}
      className="rounded-xl border bg-slate-900/40 p-4"
      style={{ borderLeftWidth: 3, borderLeftColor: item.overdue ? "#f97316" : STATUS_ACCENT[item.status] }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-white">{item.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-sm text-slate-500">
            <span className="text-slate-400">{item.repo}</span>
            <span>· {item.dimId} {item.dimLabel}</span>
            <span>· impact {item.impact}</span>
            <span>· effort {item.effort}</span>
            {/* Engine-true ROI (same math as the report's payoff chip) — the glass-box upgrade
                over the qualitative impact/effort words. Hidden when the scan predates persisted
                dimensions (null) or the gap moves nothing (0). */}
            {item.projectedPoints != null && item.projectedPoints > 0 && (
              <span
                title="Engine projection: overall-score points this repo gains if this gap is fully closed"
                className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-accent"
              >
                ↑ +{item.projectedPoints} pts{item.unlocks ? ` · unlocks ${item.unlocks}` : ""}
              </span>
            )}
          </div>
        </div>
        {due && (
          <span className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-sm ${item.overdue ? "bg-orange-500/10 text-orange-300" : "text-slate-400"}`}>
            {due}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
          status
          <select
            value={item.status}
            disabled={saving}
            onChange={(e) => onPatch(item.id, { status: e.target.value })}
            aria-label="Status"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"
            style={{ color: STATUS_ACCENT[item.status] }}
          >
            {REC_STATUSES.map((s) => (
              <option key={s} value={s} className="text-slate-200">
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
          owner
          <select
            value={item.assigneeLogin ?? ""}
            disabled={saving}
            onChange={(e) => onPatch(item.id, { assigneeLogin: e.target.value || null })}
            aria-label="Owner"
            className="max-w-[10rem] rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">Unassigned</option>
            {options.map((login) => (
              <option key={login} value={login}>
                @{login}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
          due
          <input
            type="date"
            value={item.targetDate ?? ""}
            disabled={saving}
            onChange={(e) => onPatch(item.id, { targetDate: e.target.value || null })}
            aria-label="Due date"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"
          />
        </label>

        {practice && (
          <button
            onClick={openDraftPr}
            disabled={prBusy || saving}
            title={`Open a draft PR seeding the "${practice.label}" starter into ${item.repo}`}
            className="rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 font-mono text-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
          >
            {prBusy ? "Opening PR…" : "Open draft PR →"}
          </button>
        )}

        <button
          onClick={promoteToInitiative}
          disabled={promoteBusy || promoted || saving}
          title="Roll this gap up into a tracked org initiative"
          className="rounded-md border border-slate-700 px-2.5 py-1 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
        >
          {promoted ? "✓ Initiative" : promoteBusy ? "Promoting…" : "Promote to initiative"}
        </button>

        <button
          onClick={toggleHistory}
          className="ml-auto rounded-md border border-slate-700 px-2 py-1 font-mono text-sm text-slate-400 transition hover:text-white"
        >
          {history ? "Hide history" : "History"}
        </button>
        {saving && <span className="font-mono text-sm text-slate-500">saving…</span>}
      </div>

      {error && <p className="mt-2 text-sm text-orange-300">{error}</p>}
      {prError && <p className="mt-2 text-sm text-orange-300">{prError}</p>}
      {prResult && (
        <p className="mt-2 text-sm text-emerald-300">
          {prResult.reused ? "Existing draft PR: " : "Draft PR opened: "}
          <a href={prResult.url} target="_blank" rel="noreferrer" className="underline hover:text-white">
            {prResult.url}
          </a>
        </p>
      )}

      {history && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          {history === "loading" ? (
            <p className="font-mono text-sm text-slate-500">Loading history…</p>
          ) : history.length === 0 ? (
            <p className="font-mono text-sm text-slate-500">No changes recorded yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {history.map((ev) => (
                <li key={ev.id} className="flex flex-wrap items-baseline gap-x-2 text-sm text-slate-400">
                  <span className="font-mono text-sm text-slate-600">{new Date(ev.at).toLocaleString()}</span>
                  <span className="text-slate-300">{ev.actor ? `@${ev.actor}` : "system"}</span>
                  <span>
                    set {EVENT_LABEL[ev.kind] ?? ev.kind} {eventValue(ev.kind, ev.from)} → <span className="text-slate-200">{eventValue(ev.kind, ev.to)}</span>
                  </span>
                  {ev.note && <span className="text-slate-500">“{ev.note}”</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
