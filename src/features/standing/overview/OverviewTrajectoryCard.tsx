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
// A sub-gate fit is NOT dropped in silence and is NOT drawn as a 0 slope (G4). `composeTrajectory`
// hands back the refusal in the same words PersonalOverview, the /trends panel and the Delivery
// readout print, and it is rendered verbatim. No fit at all is still absence — the card stays off.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { Trajectory } from "./Trajectory";
import { composeTrajectory, type Forecast } from "@/lib/maturity/forecast";

export function OverviewTrajectoryCard({ forecast }: { forecast: Forecast | null }) {
  const read = composeTrajectory(forecast);
  if (read.headline && forecast) return <Trajectory forecast={forecast} />;
  if (read.insufficiency === null) return null;
  return (
    <Card>
      <SectionHeader size="sm" title="Trajectory" />
      <p className="mt-3 type-body text-slate-300">{read.insufficiency}</p>
      <p className="mt-2 type-body-sm text-slate-500">
        Scan again over the coming weeks. The projection appears once there is enough spread to read a
        trend rather than noise.
      </p>
    </Card>
  );
}
