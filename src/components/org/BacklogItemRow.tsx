"use client";

import { useState } from "react";
import { REC_STATUSES, type RecEvent } from "@/lib/types";
import type { BacklogItem } from "@/lib/db";
import { PRACTICES } from "@/lib/practices";
import { EVENT_LABEL, STATUS_ACCENT, STATUS_LABEL, dueLabel, eventValue } from "@/components/org/backlogShared";

export function BacklogItemRow({
  org,
  item,
  assignees,
  saving,
  error,
  onPatch,
}: {
  org: string;
  item: BacklogItem;
  assignees: string[];
  saving: boolean;
  error?: string;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [history, setHistory] = useState<RecEvent[] | "loading" | null>(null);
  const [prBusy, setPrBusy] = useState(false);
  const [prResult, setPrResult] = useState<{ url: string; reused: boolean } | null>(null);
  const [prError, setPrError] = useState<string | null>(null);
  const [promoteBusy, setPromoteBusy] = useState(false);
  const [promoted, setPromoted] = useState(false);
  // Optimistic override for the inline status/owner/due controls. They're bound to server state
  // (`item.*`) which only updates after the PATCH + full backlog re-read completes, so on a slow save
  // the control snapped back to the old value (reading as "my edit failed") before jumping to the new
  // one. Overriding the edited field locally keeps the chosen value on screen until the refresh lands;
  // clearing it in `finally` then tracks the server again — the new value on success, the unchanged
  // old value on failure (the parent surfaces the error and never mutates `item` on a failed patch).
  const [override, setOverride] = useState<Partial<BacklogItem>>({});
  const shown = { ...item, ...override };

  async function patchField(patch: Partial<Pick<BacklogItem, "status" | "assigneeLogin" | "targetDate">>) {
    setOverride((o) => ({ ...o, ...patch }));
    try {
      await onPatch(item.id, patch);
    } finally {
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
    setPrError(null);
    try {
      const res = await fetch("/api/org/initiatives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, title: item.title, dimId: item.dimId, repos: [item.repo] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to create initiative.");
      setPromoted(true);
    } catch (e) {
      setPrError(e instanceof Error ? e.message : "Failed to create initiative.");
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
    setPrError(null);
    try {
      const res = await fetch("/api/practices/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: item.repo, practiceId: practice.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to open PR.");
      setPrResult({ url: data.url, reused: data.reused });
      if (item.status === "open") await onPatch(item.id, { status: "in_progress" });
    } catch (e) {
      setPrError(e instanceof Error ? e.message : "Failed to open PR.");
    } finally {
      setPrBusy(false);
    }
  }

  async function toggleHistory() {
    if (history) {
      setHistory(null);
      return;
    }
    setHistory("loading");
    try {
      const res = await fetch(`/api/recommendations/${item.id}/events`);
      const data = res.ok ? ((await res.json()) as { events: RecEvent[] }) : { events: [] };
      setHistory(data.events);
    } catch {
      setHistory([]);
    }
  }

  const due = dueLabel(item);

  return (
    <div
      aria-busy={saving}
      className="rounded-xl border bg-slate-900/40 p-4"
      style={{ borderLeftWidth: 3, borderLeftColor: item.overdue ? "#f97316" : STATUS_ACCENT[shown.status] }}
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
            value={shown.status}
            disabled={saving}
            onChange={(e) => patchField({ status: e.target.value })}
            aria-label="Status"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"
            style={{ color: STATUS_ACCENT[shown.status] }}
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
            value={shown.assigneeLogin ?? ""}
            disabled={saving}
            onChange={(e) => patchField({ assigneeLogin: e.target.value || null })}
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
            value={shown.targetDate ?? ""}
            disabled={saving}
            onChange={(e) => patchField({ targetDate: e.target.value || null })}
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
