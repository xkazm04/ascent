// Types for the Goals panel (GoalsPanel.tsx) — split per the `<Feature>Types.ts` convention.

export interface MetricOption {
  value: string;
  label: string;
}

/** A one-click goal suggestion (GOAL-5), derived from the fleet's own numbers. */
export interface GoalSuggestion {
  label: string;
  metric: string;
  target: number;
}
