"use client";

import { ConfirmAction, goalDeleteConfirm } from "@/components/ConfirmAction";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { GoalCard, type GoalProgressView, type LinkedInitiative } from "@/components/org/shared/goalView";
import { useGoalsPanel } from "@/components/org/plan/useGoalsPanel";
import type { GoalSuggestion, MetricOption } from "@/components/org/plan/GoalsPanelTypes";

export type { GoalSuggestion, MetricOption } from "@/components/org/plan/GoalsPanelTypes";

/**
 * Maturity goals with live progress, a trend-derived ETA/pace, and the repos that must move —
 * plus a create form. Progress and pace come from the latest scans and the metric's trend.
 * `initiativesByGoal` cross-renders the tracked initiatives linked to each goal (GOAL-6).
 * State/handlers live in `useGoalsPanel` (200-LOC cap).
 */
export function GoalsPanel({
  slug,
  initial,
  metricOptions,
  initiativesByGoal = {},
  suggestions = [],
}: {
  slug: string;
  initial: GoalProgressView[];
  metricOptions: MetricOption[];
  initiativesByGoal?: Record<string, LinkedInitiative[]>;
  /** One-click goal suggestions (GOAL-5) derived from the fleet's own numbers. */
  suggestions?: GoalSuggestion[];
}) {
  const g = useGoalsPanel({ slug, initial, metricOptions, suggestions });

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Goals"
        description="Time-bound targets the org steers toward — progress, pace and ETA track the fleet's latest scans."
      />

      {/* Always mounted, toggled by `open`, so Modal's portal is armed before the Cancel-focus effect runs. */}
      <ConfirmAction
        open={g.pendingDelete != null}
        onCancel={() => g.setPendingDeleteId(null)}
        onConfirm={() => {
          const id = g.pendingDeleteId;
          g.setPendingDeleteId(null);
          if (id) void g.remove(id);
        }}
        {...(g.pendingDelete
          ? goalDeleteConfirm(g.pendingDelete.label)
          : { title: "", body: "", confirmLabel: "", tone: "danger" as const })}
      />

      <div className="mt-4 space-y-3">
        {g.goals.length === 0 && <p className="text-base text-slate-500">No goals yet — set one below.</p>}
        {g.goals
          .filter((goal) => goal.status !== "achieved")
          .map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              slug={slug}
              initiatives={initiativesByGoal[goal.id]}
              action={
                <button onClick={() => g.setPendingDeleteId(goal.id)} className="shrink-0 font-mono text-sm text-slate-600 hover:text-orange-300">
                  remove
                </button>
              }
            />
          ))}
      </div>

      {/* GOAL-4: met goals collapse into their own group so the active list stays focused. */}
      {g.goals.some((goal) => goal.status === "achieved") && (
        <details className="group mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-mono text-sm uppercase tracking-widest text-emerald-300/80 [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="text-slate-600 transition-transform group-open:rotate-90">›</span>
            Met · {g.goals.filter((goal) => goal.status === "achieved").length} 🎉
          </summary>
          <div className="mt-3 space-y-3">
            {g.goals
              .filter((goal) => goal.status === "achieved")
              .map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  slug={slug}
                  compact
                  initiatives={initiativesByGoal[goal.id]}
                  action={
                    // Same confirm flow as the active list: deletion hard-drops the goal AND its
                    // achievedAt milestone, so an achieved goal (the history most worth keeping)
                    // must never go on a single click (goals-initiatives 07-16 #2).
                    <button onClick={() => g.setPendingDeleteId(goal.id)} className="shrink-0 font-mono text-sm text-slate-600 hover:text-orange-300">
                      remove
                    </button>
                  }
                />
              ))}
          </div>
        </details>
      )}

      {/* GOAL-5: one-click suggested goals so the org never starts from a blank box. */}
      {g.picks.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
          <span className="font-mono text-sm uppercase tracking-widest text-slate-500">Suggested</span>
          {g.picks.map((s) => (
            <button
              key={s.label}
              onClick={() => g.addSuggested(s)}
              disabled={g.busy}
              title="Add this goal"
              className="rounded-full border border-slate-700 px-2.5 py-1 text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
            >
              + {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
        <input
          value={g.label}
          onChange={(e) => g.setLabel(e.target.value)}
          placeholder="e.g. Reach AI-Native by Q3"
          aria-label="Goal name"
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
        />
        <select value={g.metric} onChange={(e) => g.setMetric(e.target.value)} aria-label="Goal metric" className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200">
          {metricOptions.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
          target
          <input
            type="number"
            min={0}
            max={100}
            value={g.target}
            onChange={(e) => g.setTarget(Number(e.target.value))}
            className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
          />
        </label>
        <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
          by
          <input
            type="date"
            value={g.targetDate}
            onChange={(e) => g.setTargetDate(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-sm text-slate-200"
          />
        </label>
        <button onClick={g.create} disabled={g.busy || !g.label.trim()} className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50">
          {g.busy ? "Adding…" : "Add goal"}
        </button>
      </div>
      {g.error && <p className="mt-2 text-sm text-orange-300">{g.error}</p>}
    </Card>
  );
}
