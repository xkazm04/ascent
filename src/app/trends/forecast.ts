// THE ONE PLACE the repo trend forecast is fit — and the deliberate absence of a `range` argument is
// the whole point (G5-01 / G4-16).
//
// THE DECISION: fit over the full history the read returned, never over the 5d/30d/90d/All slice the
// chart happens to be showing. When the viewer's plan clamps the read, "the full history" is the plan's
// sold window (see resolveHistoryWindow); otherwise it is the repository's whole recorded history.
//
//   Why not "responsive" (re-fit per displayed range)? Because a forecast that changes when the viewer
//   changes a zoom control is not a forecast. The same repo would report a different promotion ETA on
//   5d than on 90d, and the 5-day answer — a slope read off two or three scans in one sprint —
//   would look exactly as confident as the 90-day one. The range toggle answers "what do I want to
//   LOOK at"; the forecast answers "where is this repo going". Those are different questions.
//
//   DEVIATION from the governing standard (metric-forecasting, trend-fitting-and-anchoring): a display
//   filter must not reach the fit. A plan's history window is not a display filter here — it is the
//   access boundary of the read, so rows beyond it never arrive and cannot be fit (fitting older
//   history would derive a figure from data the plan does not include). The panel says so on screen:
//   "{N}-day trajectory", "fit over the N scans in the last N days, the <plan> plan's history window".
//
//   The cost of the choice is honesty about staleness, which we pay in two places: the panel states
//   the basis on screen, and `forecastInsufficiency` refuses to project at all when the history the
//   fit saw is itself too thin (< 3 distinct scan days or < 14 days of span) rather than emitting an
//   ETA with a confidence percentage attached to noise.

import { forecastTrajectory, type Forecast } from "@/lib/maturity/forecast";
import type { HistoryPoint } from "@/lib/db/scans";
import { sameRuler } from "@/lib/maturity/attribution";

// THE RULER: a rubric bump re-scores the repository, so a line fit across one reads the bump as a
// slope. The fit uses only the trailing run of points scored under the latest point's rubric, walking
// back and stopping at the first PROVABLE change (sameRuler === false) — the same policy, and the same
// consecutive-pair walk, as the timeline annotations and the alert lane. A null rubric never breaks it.
function trailingRubricRun(scans: readonly HistoryPoint[]): HistoryPoint[] {
  const newestFirst = [...scans].sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt));
  let end = 1;
  while (end < newestFirst.length && sameRuler(newestFirst[end]!.rubricVersion, newestFirst[end - 1]!.rubricVersion) !== false) end++;
  return newestFirst.slice(0, end);
}

/** When the fit was cut at a rubric change: how many points it used, of how many, and under which
 *  rubric. Null when the whole history is one ruler. Lets the panel say WHY the history is short. */
export function rubricTruncation(scans: readonly HistoryPoint[]): { used: number; total: number; rubric: string } | null {
  const run = trailingRubricRun(scans);
  if (run.length === scans.length) return null;
  const rubric = run.find((p) => p.rubricVersion)?.rubricVersion ?? "the current rubric";
  return { used: run.length, total: scans.length, rubric };
}

/**
 * Fit the repo's trajectory over the full history the read returned: the plan's sold window when one
 * applies, the whole recorded history otherwise. Never the 5d/30d/90d/All display slice.
 *
 * Takes NO range/window parameter by construction — that is the contract, not an oversight: there is
 * no argument a caller could pass to make the forecast follow the display window.
 *
 * @param scans  the full fetched history (already bounded by the plan window, if any) (any order; the fit sorts internally).
 * @param nowMs  the caller's "present" for anchoring the ETA (injected in tests).
 */
export function fitTrendForecast(scans: readonly HistoryPoint[], nowMs?: number): Forecast | null {
  // A run of one point has no slope to read, whatever the series below would do with it.
  const run = trailingRubricRun(scans);
  if (run.length < 2) return null;
  const series = run.map((s) => ({ date: s.scannedAt, value: s.overallScore, compacted: s.compacted }));
  return nowMs === undefined ? forecastTrajectory(series) : forecastTrajectory(series, 90, nowMs);
}
