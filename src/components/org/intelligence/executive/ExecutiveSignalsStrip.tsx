// GB: the Briefing tab's fleet-signals strip — adoption rate, movement count, peer-cohort percentile
// and engine mix, as ONE wrap-row instead of three stacked <p> lines. Pulled out of ExecutiveTab.tsx
// to stay under the 200-LOC cap (docs/ORG-TABS-REFACTOR.md). Server component, no state.

import { engineMixCaveat, engineMixLabel } from "@/lib/org/briefing";
import type { ExecBriefing } from "@/lib/org/briefing";

export function ExecutiveSignalsStrip({ briefing }: { briefing: ExecBriefing }) {
  if (
    briefing.adoptionRate == null &&
    briefing.movement.compared === 0 &&
    briefing.benchmark?.cohort?.overallPercentile == null &&
    briefing.engineMix.length === 0
  ) {
    return null;
  }
  const { benchmark } = briefing;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-sm text-slate-500">
      {briefing.adoptionRate != null && (
        <span>
          Fleet adoption <span className="text-slate-300">{briefing.adoptionRate}%</span> at high-adoption posture
        </span>
      )}
      {briefing.movement.compared > 0 && (
        <span>
          <span className="text-slate-300">{briefing.movement.up + briefing.movement.down}</span> of{" "}
          {briefing.movement.compared} repos moved ({briefing.movement.up}▲ / {briefing.movement.down}▼)
        </span>
      )}
      {benchmark?.cohort?.overallPercentile != null && (
        <span>
          Peer cohort <span className="text-slate-300">{benchmark.cohort.overallPercentile}th percentile</span> vs{" "}
          {benchmark.cohort.repos} {benchmark.cohort.language} repos
          {benchmark.cohort.adoptionPercentile != null ? ` · ${benchmark.cohort.adoptionPercentile}th on AI adoption` : ""}
        </span>
      )}
      {briefing.engineMix.length > 0 && (
        <span>
          Scored by {engineMixLabel(briefing.engineMix)}
          {engineMixCaveat(briefing.engineMix) && (
            <span className="text-warn"> · ⚠ {engineMixCaveat(briefing.engineMix)}</span>
          )}
        </span>
      )}
    </div>
  );
}
