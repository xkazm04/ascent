// Pure derivations for the Plan tab's core panel (goals + simulator + initiatives) — split out of
// PlanCorePanel.tsx per the `<feature><Thing>.ts` convention (docs/ORG-TABS-REFACTOR.md §3) so the
// server component stays wiring + JSX only. No JSX, no DB reads — everything here is a plain function
// over already-fetched rows.

import { DEFAULT_INITIATIVE_TARGET, DIMENSIONS, DIMENSION_BY_ID, LEVELS, SUGGESTED_GOAL_LIFT, levelForScore } from "@/lib/maturity/model";
import { PRACTICES } from "@/lib/practices";
import type { DimensionId } from "@/lib/types";
import type { OrgRollup, OrgRec, GoalProgress } from "@/lib/db";
import type { GoalSuggestion } from "@/components/org/plan/GoalsPanelTypes";
import type { SeedRec } from "@/components/org/plan/InitiativesPanelTypes";

export function dimOptionsFrom(rollup: OrgRollup | null) {
  const dimAvg = new Map((rollup?.dimAverages ?? []).map((d) => [d.dimId, d.avg]));
  return DIMENSIONS.map((d) => ({ id: d.id, label: d.name, avg: dimAvg.get(d.id) ?? 0 }));
}

export function metricOptionsFrom(metricLabelFn: (m: string) => string) {
  return [
    ...(["overall", "adoption", "rigor"] as const).map((m) => ({ value: m, label: metricLabelFn(m) })),
    ...DIMENSIONS.map((d) => ({ value: d.id, label: `${d.id} · ${d.name}` })),
  ];
}

/** Seed initiatives from the highest-leverage fleet moves; map the rec's repo *names* to fullNames
 *  (initiatives track fullNames so progress can match the latest scans). The 1:1 dimension →
 *  reusable practice map, so a seeded initiative carries its starter shape (GOAL-3). */
export function computeInitiativeSeeds(recs: OrgRec[] | null, nameToFull: Map<string, string>): SeedRec[] {
  const practiceByDim = new Map(PRACTICES.map((p) => [p.dimId, p.id]));
  return (recs ?? []).map((r) => ({
    title: r.title,
    dimId: r.dimId,
    dimLabel: DIMENSION_BY_ID[r.dimId as DimensionId]?.name ?? r.dimId,
    practiceId: practiceByDim.get(r.dimId as DimensionId) ?? null,
    repos: r.repos.map((n) => nameToFull.get(n)).filter((x): x is string => !!x),
    repoCount: r.repoCount,
  }));
}

/** GOAL-6: cross-render — group the initiatives linked to each goal so a goal shows its plan. */
export function computeInitiativesByGoal(initiatives: { id: string; title: string; status: string; goalId: string | null }[] | null) {
  const byGoal: Record<string, { id: string; title: string; status: string }[]> = {};
  for (const i of initiatives ?? []) {
    if (!i.goalId) continue;
    (byGoal[i.goalId] ||= []).push({ id: i.id, title: i.title, status: i.status });
  }
  return byGoal;
}

/** GOAL-5: seed 2-3 one-click goal suggestions so an org never starts from a blank box. Derived from
 *  the fleet's own numbers (weakest scanned dimension; overall to the next maturity band; an adoption
 *  floor) and de-duplicated against metrics that already have an active goal. */
export function computeGoalSuggestions(
  rollup: OrgRollup,
  goals: Pick<GoalProgress, "status" | "metric">[] | null,
  dimOptions: { id: string; label: string; avg: number }[],
): GoalSuggestion[] {
  const activeMetrics = new Set((goals ?? []).filter((g) => g.status === "active").map((g) => g.metric));
  const suggestions: GoalSuggestion[] = [];
  const weakest = dimOptions.filter((d) => d.avg > 0).sort((a, b) => a.avg - b.avg)[0];
  if (weakest && !activeMetrics.has(weakest.id)) {
    const target = Math.min(100, weakest.avg + SUGGESTED_GOAL_LIFT);
    suggestions.push({ label: `Lift ${weakest.id} · ${weakest.label} to ${target}`, metric: weakest.id, target });
  }
  if (!activeMetrics.has("overall")) {
    const idx = LEVELS.findIndex((l) => l.id === levelForScore(rollup.avgOverall).id);
    const next = idx >= 0 && idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null;
    if (next) suggestions.push({ label: `Reach ${next.id} · ${next.name} (overall ${next.band[0]})`, metric: "overall", target: next.band[0] });
  }
  if (suggestions.length < 3 && !activeMetrics.has("adoption") && rollup.avgAdoption < DEFAULT_INITIATIVE_TARGET) {
    suggestions.push({
      label: `AI Adoption to ${DEFAULT_INITIATIVE_TARGET}`,
      metric: "adoption",
      target: DEFAULT_INITIATIVE_TARGET,
    });
  }
  return suggestions;
}
