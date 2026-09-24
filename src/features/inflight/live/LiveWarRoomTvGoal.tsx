// The TV Standing stage's goal card, extracted from LiveWarRoomTvStages.tsx to keep that file under
// the features/ 200-LOC cap. Rendered big for a wall read from across a room.

import { Kicker } from "@/components/ui";
import { Meter } from "@/components/org/shared/ui";
import { goalBasisMarker, goalMeterAriaLabel, type GoalProgressView } from "@/components/org/shared/goalView";
import { goalUnmeasuredLine } from "@/components/org/shared/goalViewLogic";
import { goalMeterColor } from "@/features/inflight/live/LiveWarRoomGoalBanner";
import { WallPaceChip } from "@/features/inflight/live/WallPaceChip";

export function TvGoalCard({ goal }: { goal: GoalProgressView }) {
  return (
    <div className="rounded-2xl border border-divider bg-surface-strong/30 p-5">
      <div className="flex items-center justify-between gap-2">
        <Kicker tone="muted">Goal</Kicker>
        <WallPaceChip goal={goal} />
      </div>
      <p className="mt-1 type-lede font-medium text-white">{goal.label}</p>
      {goal.current === null ? (
        // Unmeasured (G19): nothing has scored the metric, so no numeral and no meter; a big 0 on a
        // wall reads as a fleet at zero that nobody observed.
        <p className="mt-2 font-mono type-title text-slate-400">{goalUnmeasuredLine(goal)}</p>
      ) : (
        <>
          <div className="mt-2 font-mono type-display-lg font-bold tabular-nums" style={{ color: goalMeterColor(goal) }}>
            {goal.current}
            <span className="type-title text-slate-500">/{goal.target}</span>
          </div>
          {/* TV mode is a wall in a room: no hover, no screen reader, read from across it. So the
              attainment basis is VISIBLE text under the bar (the aria label repeats it for the
              browser reader) — a goal set before baselines existed opens near-full, and unlabelled
              next to a progress goal that opens empty it invites a comparison neither supports. */}
          <Meter className="mt-2" value={goal.current} threshold={goal.target} color={goalMeterColor(goal)} ariaLabel={goalMeterAriaLabel(goal)} />
          {goalBasisMarker(goal) && (
            <p className="mt-1.5 font-mono type-body text-slate-500">{goalBasisMarker(goal)}</p>
          )}
        </>
      )}
    </div>
  );
}
