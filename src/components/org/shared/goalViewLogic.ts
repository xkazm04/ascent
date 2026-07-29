// Pure functions/constants for the shared goal view (goalView.tsx). Split out per
// docs/ORG-TABS-REFACTOR.md's extraction order (pure functions before JSX regions) to keep
// goalView.tsx under the 200-LOC cap. Re-exported from goalView.tsx so every existing import site
// is unchanged.

import { humanizeDays, type GoalPace } from "@/lib/maturity/forecast";
import type { GoalProgressView } from "./GoalViewTypes";

/** The canonical pace-verdict palette + labels, keyed on GoalPace. Exported as the single source for
 *  the pace colors so other surfaces (the org overview headline tile) don't re-state the hex values. */
export const GOAL_PACE_TONE: Record<GoalPace, { label: string; color: string }> = {
  reached: { label: "Reached", color: "#34d399" },
  "on-pace": { label: "On pace", color: "#84cc16" },
  behind: { label: "Behind", color: "#f97316" },
  tracking: { label: "Tracking", color: "#94a3b8" },
};

export const rate = (n: number) => `${n > 0 ? "+" : ""}${n}/wk`;

/** One-line, leader-facing read of a goal's pace — the detail under the progress meter. */
export function readout(g: GoalProgressView): string {
  if (g.pace === "reached") return `Target met — holding at or above ${g.target}.`;

  const eta = g.etaDate ? `reaches ${g.target} ${humanizeDays(g.etaDays ?? 0)} (${g.etaDate})` : null;

  if (g.pace === "on-pace") {
    return `On pace — ${eta}${g.targetDate ? `, ahead of ${g.targetDate}` : ""}.`;
  }
  if (g.pace === "behind") {
    const need = g.requiredPerWeek != null ? ` — needs ${rate(g.requiredPerWeek)} (now ${rate(g.perWeek)})` : "";
    if (eta) return `Behind — at ${rate(g.perWeek)}, ${eta}, past the ${g.targetDate} deadline${need}.`;
    return `Behind — flat at ${g.current} on a ${rate(g.perWeek)} trend, target not reached at this pace${need}.`;
  }
  // tracking: no deadline, or not enough trend to judge a pace yet.
  if (eta) return `On track — ${eta}.`;
  if (g.fitQuality === 0 && g.perWeek === 0) {
    return g.requiredPerWeek != null
      ? `Not enough trend yet — needs ${rate(g.requiredPerWeek)} to reach ${g.target} by ${g.targetDate}.`
      : `Not enough trend yet — scan over time to project an ETA.`;
  }
  return `Holding near ${g.current} on a ${rate(g.perWeek)} trend — no ETA to ${g.target} at this pace.`;
}

export const INIT_STATUS_LABEL: Record<string, string> = {
  open: "open",
  in_progress: "in progress",
  done: "done",
  dismissed: "dismissed",
};
