// The Briefing tab's "Trajectory" card — forecast headline + confidence note + regression callout.
// Pulled out of ExecutiveTab.tsx to stay under the 200-LOC cap (docs/ORG-TABS-REFACTOR.md). Server
// component, no state.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { forecastConfidenceNote } from "@/lib/org/briefing";
import type { ExecBriefing } from "@/lib/org/briefing";

export function ExecutiveTrajectoryCard({ briefing, periodHasStart }: { briefing: ExecBriefing; periodHasStart: boolean }) {
  if (!briefing.forecastHeadline && briefing.regressionCount === 0) return null;
  return (
    <Card>
      <SectionHeader size="sm" title="Trajectory" />
      <p className="mt-2 text-base text-slate-300">
        {briefing.forecastHeadline ?? "Not enough history yet to project a trajectory."}
      </p>
      {briefing.forecastHeadline && forecastConfidenceNote(briefing.forecastConfidence) && (
        <p className="mt-1 font-mono text-sm text-slate-500">{forecastConfidenceNote(briefing.forecastConfidence)}</p>
      )}
      {briefing.regressionCount > 0 && (
        <p className="mt-1 font-mono text-sm text-orange-300">
          ⚠ {briefing.regressionCount} repo{briefing.regressionCount > 1 ? "s" : ""} regressed{" "}
          {periodHasStart ? "this period" : "since last scan"}.
        </p>
      )}
    </Card>
  );
}
