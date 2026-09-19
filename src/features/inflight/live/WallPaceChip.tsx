// Wall PaceChip: the briefing's presentability gate, drawn. A presentable fit prints the pace
// verdict; a real-but-thin fit hatches the slot and prints no numeral (G4); no fit at all is
// absence — the chip is hidden, not a fabricated "Tracking".

import { PaceChip, type GoalProgressView } from "@/components/org/shared/goalView";
import { HATCH_ID, VizDefs } from "@/components/org/viz";
import { wallGoalTrajectoryRead } from "./liveWarRoomGoalPace";

export function WallPaceChip({ goal }: { goal: GoalProgressView }) {
  const read = wallGoalTrajectoryRead(goal.series);
  if (read.headline) return <PaceChip pace={goal.pace} />;
  if (!read.insufficiency) return null;
  return (
    <svg
      viewBox="0 0 28 14"
      width={28}
      height={14}
      className="shrink-0"
      role="img"
      aria-label={read.insufficiency}
      data-pace="not-judged"
    >
      <title>{read.insufficiency}</title>
      <VizDefs />
      <rect
        data-hatch
        x={0.5}
        y={0.5}
        width={27}
        height={13}
        rx={7}
        fill={`url(#${HATCH_ID})`}
        stroke="var(--color-divider)"
        strokeWidth={1}
      />
    </svg>
  );
}
