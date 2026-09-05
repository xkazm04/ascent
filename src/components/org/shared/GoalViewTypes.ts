// Types for the shared goal view (goalView.tsx). Split out per docs/ORG-TABS-REFACTOR.md's naming
// convention (<Feature>Types.ts) to keep goalView.tsx under the 200-LOC cap. Re-exported from
// goalView.tsx so every existing import site is unchanged.

import type { GoalPace, SeriesPoint, Trajectory } from "@/lib/maturity/forecast";
import type { GoalLaggard, GoalPctBasis } from "@/lib/db/plan";

/** The serializable shape the goal UI renders — mirrors GoalProgress from src/lib/db/plan.ts. */
export interface GoalProgressView {
  id: string;
  label: string;
  metric: string;
  metricLabel: string;
  target: number;
  current: number;
  pct: number;
  /** Which question `pct` answers — `"progress"` (measured from the baseline stored at creation) or
   *  `"attainment"` (current over target, for a goal created before baselines existed). The two open
   *  at opposite ends of the bar, so a meter rendered without this says nothing a reader can trust.
   *  OPTIONAL for the same reason `series?` is: a caller holding a pre-baseline payload still renders,
   *  it just omits the basis marker rather than asserting the wrong one. */
  pctBasis?: GoalPctBasis;
  /** Ready-to-render caption for `pctBasis` (`GOAL_PCT_LABEL`, re-exported from `@/lib/db`), so every
   *  surface says the same thing about the same number. Optional for the same reason. */
  pctLabel?: string;
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
