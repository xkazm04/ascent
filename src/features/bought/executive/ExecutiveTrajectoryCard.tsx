// The Briefing tab's "Trajectory" card — forecast headline + confidence note + regression callout.
// Pulled out of ExecutiveTab.tsx to stay under the 200-LOC cap (docs/ORG-TABS-REFACTOR.md). Server
// component, no state.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { briefingTrajectory, briefingTrajectoryNote } from "@/lib/org/briefing";
import type { ExecBriefing } from "@/lib/org/briefing";

export function ExecutiveTrajectoryCard({ briefing, periodHasStart }: { briefing: ExecBriefing; periodHasStart: boolean }) {
  // MC-B1 — one composed read for every briefing surface. A headline only ever arrives here having
  // cleared the shared presentability gate, and it arrives WITH its hedge; when the fit was real but
  // too thin, `insufficiency` carries Delivery's own refusal sentence instead of a bare slope.
  const traj = briefingTrajectory(briefing);
  const note = briefingTrajectoryNote(briefing);
  if (!traj.headline && !traj.insufficiency && briefing.regressionCount === 0) return null;
  return (
    <Card>
      <SectionHeader size="sm" title="Trajectory" />
      <p className="mt-2 type-body text-slate-300">
        {traj.headline ?? traj.insufficiency ?? "Not enough history yet to project a trajectory."}
      </p>
      {traj.headline && note && <p className="mt-1 type-mono-sm text-slate-500">{note}</p>}
      {briefing.regressionCount > 0 && (
        <p className="mt-1 type-mono-sm text-orange-300">
          ⚠ {briefing.regressionCount} repo{briefing.regressionCount > 1 ? "s" : ""} regressed{" "}
          {periodHasStart ? "this period" : "since last scan"}.
        </p>
      )}
    </Card>
  );
}
