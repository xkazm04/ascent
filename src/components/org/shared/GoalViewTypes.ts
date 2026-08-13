// Types for the shared goal view (goalView.tsx). Split out per docs/ORG-TABS-REFACTOR.md's naming
// convention (<Feature>Types.ts) to keep goalView.tsx under the 200-LOC cap. Re-exported from
// goalView.tsx so every existing import site is unchanged.

import type { GoalPace, SeriesPoint, Trajectory } from "@/lib/maturity/forecast";
import type { GoalLaggard } from "@/lib/db/plan";

/** The serializable shape the goal UI renders — mirrors GoalProgress from src/lib/db/plan.ts. */
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
  /** When the goal first met its target (ISO), or null — drives the "Achieved" state. */
  achievedAt?: string | null;
  createdAt?: string;
  targetDate: string | null;
  pace: GoalPace;
  perWeek: number;
  trajectory: Trajectory;
  fitQuality: number;
  etaDays: number | null;
  etaDate: string | null;
  requiredPerWeek: number | null;
  laggards: GoalLaggard[];
  belowCount: number;
  /** The metric's per-day trend the pace was fitted on (display-clamped server-side). OPTIONAL so
   *  callers holding pre-series payloads still render — the card just omits the trend line. */
  series?: SeriesPoint[];
}

/** An initiative linked to a goal — the tracked work advancing it (GOAL-6 cross-render). */
export interface LinkedInitiative {
  id: string;
  title: string;
  status: string;
}
