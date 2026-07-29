"use client";

// State + handlers for the Goals panel (GoalsPanel.tsx) — extracted per the extraction order in
// docs/ORG-TABS-REFACTOR.md §3 so the component file stays JSX + wiring only, under the 200-LOC cap.

import { useState } from "react";
import type { GoalProgressView } from "@/components/org/shared/goalView";
import type { GoalSuggestion, MetricOption } from "@/components/org/plan/GoalsPanelTypes";

export function useGoalsPanel({
  slug,
  initial,
  metricOptions,
  suggestions,
}: {
  slug: string;
  initial: GoalProgressView[];
  metricOptions: MetricOption[];
  suggestions: GoalSuggestion[];
}) {
  const [goals, setGoals] = useState<GoalProgressView[]>(initial);
  const [label, setLabel] = useState("");
  const [metric, setMetric] = useState(metricOptions[0]?.value ?? "overall");
  const [target, setTarget] = useState(50);
  const [targetDate, setTargetDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local copy so a one-click-added suggestion disappears from the row without a server round-trip.
  const [picks, setPicks] = useState<GoalSuggestion[]>(suggestions);
  // "remove" hard-deletes the goal AND its achievement history — irreversible, so it only REQUESTS
  // deletion; the DELETE runs after an explicit confirm that names the goal.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingDelete = goals.find((g) => g.id === pendingDeleteId) ?? null;

  async function refresh() {
    const res = await fetch(`/api/org/goals?org=${encodeURIComponent(slug)}`);
    if (!res.ok) return;
    const next: GoalProgressView[] = (await res.json()).goals ?? [];
    setGoals(next);
    // Reconcile the client-side suggestion list: drop any "+ Lift Dx" chip whose metric is now covered
    // by an active goal. Otherwise a metric just added via the form/another suggestion still shows its
    // chip, and clicking it creates a duplicate goal (the API has no per-metric uniqueness check).
    const covered = new Set(next.map((g) => g.metric));
    setPicks((ps) => ps.filter((p) => !covered.has(p.metric)));
  }

  async function create() {
    if (!label.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, label: label.trim(), metric, target, targetDate: targetDate || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed.");
      setLabel("");
      setTargetDate("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    // Optimistic delete WITH a failure path: a 403 (lost session) / 404 / network error used to leave the
    // goal gone from the UI but alive in the DB, shown as success. Snapshot first, then restore + surface
    // the error if the DELETE didn't actually persist (goals-initiatives #2).
    const prev = goals;
    setGoals((g) => g.filter((x) => x.id !== id));
    setError(null);
    try {
      const res = await fetch(`/api/org/goals/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to delete goal.");
    } catch (e) {
      setGoals(prev);
      setError(e instanceof Error ? e.message : "Failed to delete goal.");
    }
  }

  // GOAL-5: one-click add a suggested goal, then drop it from the row.
  async function addSuggested(s: GoalSuggestion) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, label: s.label, metric: s.metric, target: s.target, targetDate: null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed.");
      setPicks((ps) => ps.filter((p) => p !== s));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return {
    goals, label, setLabel, metric, setMetric, target, setTarget, targetDate, setTargetDate,
    busy, error, picks, pendingDeleteId, setPendingDeleteId, pendingDelete,
    create, remove, addSuggested,
  };
}
