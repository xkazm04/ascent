// The FLEET's trajectory card, in the Overview ledger — the same forward-looking read the individual
// tier already gets per repo, over the org maturity trend.
//
// `getOrgRollup` has always computed `forecast` on the landing path (forecastTrajectory over the
// per-day trend series) and the Overview threw it away: the fleet leader got a sparkline and an
// arrow, while a personal workspace tracking three public repos got the projected level, the weekly
// rate, the promotion/demotion ETA and the fit's confidence. Nothing new is fetched here — this card
// renders a number the tab already paid for.
//
// THE GATE IS `composeTrajectory`, the shared presentability rule (MC-B34), not `forecast !== null`.
// A fit exists as soon as there are two readings; whether it may be PROJECTED is a separate question
// — at least MIN_FORECAST_POINTS distinct scan days across MIN_FORECAST_SPAN_DAYS calendar days,
// because a line through two points fits perfectly however noisy the data. A fleet ETA is the single
// most quotable number on this page and the one a leader is most likely to repeat in a room; it does
// not get to be manufactured from a two-day blip.
//
// Below the gate this renders NOTHING, which is where it deliberately parts company with
// PersonalOverview: there, a tracked repo whose neighbours have a card needs the verbatim refusal to
// explain the hole in the grid. Here there is no grid and no comparison — one absent card in a
// single-column ledger reads as "not yet", and a paragraph explaining an absence nobody noticed would
// spend the top of the fleet's front page saying we have nothing to say.

import { Trajectory } from "./Trajectory";
import { composeTrajectory, type Forecast } from "@/lib/maturity/forecast";

export function OverviewTrajectoryCard({ forecast }: { forecast: Forecast | null }) {
  // `composeTrajectory(null)` is all-nulls, so the null case falls out of the same predicate — but
  // keep the early return: it says the "no fit at all" case is expected, not an edge.
  if (!forecast) return null;
  if (composeTrajectory(forecast).headline === null) return null;
  return <Trajectory forecast={forecast} />;
}
