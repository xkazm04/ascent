"use client";

import { useState } from "react";
import { Card, Meter, SectionHeader } from "@/components/org/ui";
import { scoreHex } from "@/lib/ui";

export interface GoalProgressView {
  id: string;
  label: string;
  metric: string;
  metricLabel: string;
  target: number;
  current: number;
  pct: number;
  achieved: boolean;
  status: string;
}

interface MetricOption {
  value: string;
  label: string;
}

/** Maturity goals with live progress + a create form. Progress comes from the latest scans. */
export function GoalsPanel({ slug, initial, metricOptions }: { slug: string; initial: GoalProgressView[]; metricOptions: MetricOption[] }) {
  const [goals, setGoals] = useState<GoalProgressView[]>(initial);
  const [label, setLabel] = useState("");
  const [metric, setMetric] = useState(metricOptions[0]?.value ?? "overall");
  const [target, setTarget] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/org/goals?org=${encodeURIComponent(slug)}`);
    if (res.ok) setGoals((await res.json()).goals ?? []);
  }

  async function create() {
    if (!label.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, label: label.trim(), metric, target }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed.");
      setLabel("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setGoals((g) => g.filter((x) => x.id !== id));
    await fetch(`/api/org/goals/${id}`, { method: "DELETE" });
  }

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Goals"
        description="Targets the org is steering toward — progress tracks the fleet's latest scans."
      />
      <div className="mt-4 space-y-3">
        {goals.length === 0 && <p className="text-sm text-slate-500">No goals yet — set one below.</p>}
        {goals.map((g) => (
          <div key={g.id} className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">{g.label}</div>
                <div className="font-mono text-[11px] text-slate-500">
                  {g.metricLabel} · {g.current}/{g.target}
                  {g.achieved && <span className="ml-2 text-emerald-400">✓ achieved</span>}
                </div>
              </div>
              <button onClick={() => remove(g.id)} className="shrink-0 font-mono text-[11px] text-slate-600 hover:text-orange-300">
                remove
              </button>
            </div>
            <Meter className="mt-2" size="sm" value={g.pct} color={g.achieved ? "#34d399" : scoreHex(g.current)} />
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Reach AI-Native by Q3"
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600"
        />
        <select value={metric} onChange={(e) => setMetric(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200">
          {metricOptions.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
          target
          <input
            type="number"
            min={0}
            max={100}
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
          />
        </label>
        <button onClick={create} disabled={busy || !label.trim()} className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/20 disabled:opacity-50">
          {busy ? "Adding…" : "Add goal"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-orange-300">{error}</p>}
    </Card>
  );
}
