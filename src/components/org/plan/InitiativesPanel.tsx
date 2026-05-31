"use client";

import { useState } from "react";
import { Card, Meter, SectionHeader } from "@/components/org/ui";

export interface InitiativeView {
  id: string;
  title: string;
  dimId: string;
  dimLabel: string;
  targetScore: number;
  repos: string[];
  status: string;
  progress: { atTarget: number; total: number };
}

export interface SeedRec {
  title: string;
  dimId: string;
  dimLabel: string;
  repos: string[]; // fullNames in scope
  repoCount: number;
}

const STATUSES = ["open", "in_progress", "done", "dismissed"];
const STATUS_LABEL: Record<string, string> = { open: "Open", in_progress: "In progress", done: "Done", dismissed: "Dismissed" };

/** Tracked, scoped programs of work — created from the fleet's highest-leverage moves. */
export function InitiativesPanel({ slug, initial, seeds }: { slug: string; initial: InitiativeView[]; seeds: SeedRec[] }) {
  const [items, setItems] = useState<InitiativeView[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/org/initiatives?org=${encodeURIComponent(slug)}`);
    if (res.ok) setItems((await res.json()).initiatives ?? []);
  }

  async function track(seed: SeedRec) {
    setBusy(seed.title);
    setError(null);
    try {
      const res = await fetch("/api/org/initiatives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, title: seed.title, dimId: seed.dimId, repos: seed.repos, targetScore: 70 }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(id: string, status: string) {
    setItems((xs) => xs.map((i) => (i.id === id ? { ...i, status } : i)));
    await fetch(`/api/org/initiatives/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  const trackedTitles = new Set(items.map((i) => i.title));
  const available = seeds.filter((s) => !trackedTitles.has(s.title)).slice(0, 5);

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Initiatives"
        description="Bundle a fleet move into a tracked program — progress counts the scoped repos already at target."
      />

      <div className="mt-4 space-y-3">
        {items.length === 0 && <p className="text-sm text-slate-500">No initiatives yet — start one from a fleet move below.</p>}
        {items.map((i) => {
          const pct = i.progress.total ? Math.round((i.progress.atTarget / i.progress.total) * 100) : 0;
          return (
            <div key={i.id} className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">{i.title}</div>
                  <div className="font-mono text-[11px] text-slate-500">
                    {i.dimId} {i.dimLabel} · target {i.targetScore} · {i.progress.atTarget}/{i.progress.total} repos there
                  </div>
                </div>
                <select
                  value={i.status}
                  onChange={(e) => setStatus(i.id, e.target.value)}
                  className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-200"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <Meter className="mt-2" size="sm" value={pct} color="#34d399" />
            </div>
          );
        })}
      </div>

      {available.length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Start from a fleet move</div>
          <div className="mt-2 space-y-2">
            {available.map((s) => (
              <div key={s.title} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-200">{s.title}</div>
                  <div className="font-mono text-[11px] text-slate-500">{s.dimId} · affects {s.repoCount} repos</div>
                </div>
                <button
                  onClick={() => track(s)}
                  disabled={busy === s.title}
                  className="shrink-0 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-accent hover:text-white disabled:opacity-50"
                >
                  {busy === s.title ? "…" : "Track"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-orange-300">{error}</p>}
    </Card>
  );
}
