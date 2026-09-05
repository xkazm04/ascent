// THE ONE PLACE the repo trend forecast is fit — and the deliberate absence of a `range` argument is
// the whole point (G5-01 / G4-16).
//
// THE DECISION: fit over the repository's FULL recorded history, never over the 5d/30d/90d/All slice
// the chart happens to be showing.
//
//   Why not "responsive" (re-fit per displayed range)? Because a forecast that changes when the viewer
//   changes a zoom control is not a forecast. The same repo would report a different promotion ETA on
//   5d than on 90d, and the 5-day answer — a slope read off two or three scans in one sprint —
//   would look exactly as confident as the 90-day one. The range toggle answers "what do I want to
//   LOOK at"; the forecast answers "where is this repo going". Those are different questions.
//
//   The cost of the choice is honesty about staleness, which we pay in two places: the panel states
//   the basis on screen ("fit over all N scans"), and `forecastInsufficiency` refuses to project at
//   all when the full history is itself too thin (< 3 distinct scan days or < 14 days of span) rather
//   than emitting an ETA with a confidence percentage attached to noise.

import { forecastTrajectory, type Forecast } from "@/lib/maturity/forecast";
import type { HistoryPoint } from "@/lib/db/scans";

/**
 * Fit the repo's trajectory over its full history.
 *
 * Takes NO range/window parameter by construction — that is the contract, not an oversight: there is
 * no argument a caller could pass to make the forecast follow the display window.
 *
 * @param scans  the full fetched history (any order; the fit sorts internally).
 * @param nowMs  the caller's "present" for anchoring the ETA (injected in tests).
 */
export function fitTrendForecast(scans: readonly HistoryPoint[], nowMs?: number): Forecast | null {
  const series = scans.map((s) => ({ date: s.scannedAt, value: s.overallScore }));
  return nowMs === undefined ? forecastTrajectory(series) : forecastTrajectory(series, 90, nowMs);
}
