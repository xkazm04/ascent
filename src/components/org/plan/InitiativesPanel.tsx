"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, Meter, SectionHeader } from "@/components/org/ui";

export interface InitiativeView {
  id: string;
  title: string;
  dimId: string;
  dimLabel: string;
  practiceId: string | null;
  targetScore: number;
  repos: string[];
  status: string;
  assigneeLogin: string | null;
  targetDate: string | null;
  goalId: string | null;
  goalLabel: string | null;
  progress: { atTarget: number; total: number };
}

export interface SeedRec {
  title: string;
  dimId: string;
  dimLabel: string;
  practiceId: string | null; // the dimension's reusable practice — for the starter shape
  repos: string[]; // fullNames in scope
  repoCount: number;
}

export interface GoalOption {
  id: string;
  label: string;
}

const STATUSES = ["open", "in_progress", "done", "dismissed"];
const STATUS_LABEL: Record<string, string> = { open: "Open", in_progress: "In progress", done: "Done", dismissed: "Dismissed" };

/** Tracked, scoped programs of work — created from the fleet's highest-leverage moves. */
export function InitiativesPanel({
  slug,
  initial,
  seeds,
  goals = [],
}: {
  slug: string;
  initial: InitiativeView[];
  seeds: SeedRec[];
  /** Active goals this org steers toward — an initiative can be linked to the one it advances. */
  goals?: GoalOption[];
}) {
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
        body: JSON.stringify({ org: slug, title: seed.title, dimId: seed.dimId, practiceId: seed.practiceId, repos: seed.repos, targetScore: 70 }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  // Optimistically patch one initiative and persist the same fields. `goalLabel` is kept in sync
  // locally when the link changes so the chip updates without a refetch.
  async function patch(id: string, body: Partial<Pick<InitiativeView, "status" | "assigneeLogin" | "targetDate" | "goalId">>) {
    setItems((xs) =>
      xs.map((i) =>
        i.id === id
          ? { ...i, ...body, ...("goalId" in body ? { goalLabel: goals.find((g) => g.id === body.goalId)?.label ?? null } : {}) }
          : i,
      ),
    );
    await fetch(`/api/org/initiatives/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
        {items.length === 0 && <p className="text-base text-slate-500">No initiatives yet — start one from a fleet move below.</p>}
        {items.map((i) => {
          const pct = i.progress.total ? Math.round((i.progress.atTarget / i.progress.total) * 100) : 0;
          return (
            <div key={i.id} className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-base font-medium text-white">{i.title}</div>
                  <div className="font-mono text-sm text-slate-500">
                    {i.dimId} {i.dimLabel} · target {i.targetScore} · {i.progress.atTarget}/{i.progress.total} repos there
                  </div>
                </div>
                <select
                  value={i.status}
                  onChange={(e) => patch(i.id, { status: e.target.value })}
                  className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-sm text-slate-200"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <Meter className="mt-2" size="sm" value={pct} color="#34d399" />

              {/* Accountability row: owner · due date · the goal this advances. */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-800/70 pt-3">
                <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
                  <span className="text-slate-600">@</span>
                  <input
                    defaultValue={i.assigneeLogin ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (i.assigneeLogin ?? "")) patch(i.id, { assigneeLogin: v || null });
                    }}
                    placeholder="assignee"
                    className="w-28 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200 placeholder:text-slate-600"
                  />
                </label>
                <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
                  due
                  <input
                    type="date"
                    value={i.targetDate ?? ""}
                    onChange={(e) => patch(i.id, { targetDate: e.target.value || null })}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-sm text-slate-200"
                  />
                </label>
                {goals.length > 0 && (
                  <label className="flex min-w-0 items-center gap-1.5 font-mono text-sm text-slate-500">
                    goal
                    <select
                      value={i.goalId ?? ""}
                      onChange={(e) => patch(i.id, { goalId: e.target.value || null })}
                      className="max-w-[12rem] truncate rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-sm text-slate-200"
                    >
                      <option value="">— none —</option>
                      {goals.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {/* GOAL-3: jump to the dimension's reusable practice (its leak-free starter +
                    "generate the artifact, open a draft PR" action) — turning the tracked target
                    into a concrete first step. */}
                {i.practiceId && (
                  <Link
                    href={`/org/${slug}/practices#practice-${i.practiceId}`}
                    className="font-mono text-sm text-accent hover:text-white"
                    title="Open the reusable practice + starter PR for this dimension"
                  >
                    starter shape →
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {available.length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-4">
          <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Start from a fleet move</div>
          <div className="mt-2 space-y-2">
            {available.map((s) => (
              <div key={s.title} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-base text-slate-200">{s.title}</div>
                  <div className="font-mono text-sm text-slate-500">{s.dimId} · affects {s.repoCount} repos</div>
                </div>
                <button
                  onClick={() => track(s)}
                  disabled={busy === s.title}
                  className="shrink-0 rounded-lg border border-slate-700 px-2.5 py-1.5 text-sm text-slate-300 hover:border-accent hover:text-white disabled:opacity-50"
                >
                  {busy === s.title ? "…" : "Track"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-orange-300">{error}</p>}
    </Card>
  );
}
