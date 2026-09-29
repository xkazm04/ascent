// The trajectory region's gate, shared by both compositions: a presentable fit draws the chart, a fit
// that cannot be presented says why in words (never a slope), and no forecast at all draws nothing.
import { composeTrajectory, type Forecast } from "@/lib/maturity/forecast";

export type TrajectoryView = { kind: "chart"; forecast: Forecast } | { kind: "insufficient"; text: string } | { kind: "none" };

export function trajectoryView(forecast: Forecast | null): TrajectoryView {
  const read = composeTrajectory(forecast);
  if (read.headline && forecast) return { kind: "chart", forecast };
  if (read.insufficiency === null) return { kind: "none" };
  return { kind: "insufficient", text: read.insufficiency };
}
