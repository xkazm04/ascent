// The wall PaceChip consults the SAME presentability gate as the briefing trajectory
// (`composeTrajectory`). A fit exists as soon as there are two readings; whether a pace verdict
// may be printed is a separate question. G4: an unpresentable fit does not get to state a slope.

import {
  composeTrajectory,
  forecastTrajectory,
  type SeriesPoint,
  type TrajectoryRead,
} from "@/lib/maturity/forecast";

/** Same composed read the briefing, digest, and /trends panel use. Pure. */
export function wallGoalTrajectoryRead(series: SeriesPoint[] | undefined): TrajectoryRead {
  return composeTrajectory(forecastTrajectory(series ?? []));
}
