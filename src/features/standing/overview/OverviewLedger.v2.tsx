// v2 composition of the Overview's data region (Prism). Same data as OverviewLedger, recomposed:
//   1. the standing MASTHEAD, the one dominant element (org level and score as a statement, figures beside it),
//   2. the "Fix first" band (a server slot, so its own Suspense boundary still streams independently),
//   3. the fleet trajectory, in words when the fit cannot be presented,
//   4. the nine dimensions as spectral lines grouped by SDLC phase,
//   5. the repo x dimension matrix (the evidence level: who is strong or weak, cell by cell),
//   6. posture composition, and the fleet rollup as ruled cohorts.
// Server component: every child that holds interaction state is its own client file.
import type { ReactNode } from "react";
import { Caption, Frame } from "@/components/kit";
import { DIMS } from "@/components/org/shared/ui";
import { buildDimensionReadings } from "./dimensionReading";
import { DimensionLedger } from "./DimensionLedger.v2";
import { DimensionMatrix } from "./DimensionMatrix.v2";
import { FleetRollup } from "./FleetRollup.v2";
import type { OverviewLedgerData } from "./OverviewLedger";
import { PostureLine } from "./PostureLine.v2";
import { StandingMasthead } from "./StandingMasthead.v2";
import { Trajectory } from "./Trajectory";
import { trajectoryView } from "./trajectoryRead";

export function OverviewLedgerV2({ fixFirst, ...d }: OverviewLedgerData & { fixFirst?: ReactNode }) {
  const readings = buildDimensionReadings(d.dims, d.dimDeltas, d.heatmapRows, d.deltaLabel);
  const traj = trajectoryView(d.forecast);
  return (
    <div className="space-y-10">
      <StandingMasthead slug={d.slug} badges={d.badges} trend={d.trend} />
      {fixFirst}
      {traj.kind === "chart" && <Trajectory forecast={traj.forecast} />}
      {traj.kind === "insufficient" && (
        <Frame pad="sm" aria-label="Trajectory">
          <Caption>Trajectory. {traj.text} The projection appears once there is enough spread to read a trend rather than noise.</Caption>
        </Frame>
      )}
      <DimensionLedger slug={d.slug} readings={readings} search={d.search} />
      {d.heatmapRows.length > 0 && <DimensionMatrix org={d.slug} dims={DIMS} rows={d.heatmapRows} initialSortDim={d.sortDim} />}
      <PostureLine slug={d.slug} postureCounts={d.postureCounts} search={d.search} />
      <div data-tour="results-view">
        <FleetRollup trajectories={d.trajectories} periodTitle={d.periodTitle} orgSlug={d.slug} />
      </div>
    </div>
  );
}
