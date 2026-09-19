// GB: the Briefing tab's fleet-signals strip — adoption rate, movement count, peer-cohort percentile
// and engine mix, as ONE wrap-row instead of three stacked <p> lines. Pulled out of ExecutiveTab.tsx
// to stay under the 200-LOC cap (docs/ORG-TABS-REFACTOR.md). Server component, no state.

import { engineMixCaveat, engineMixLabel, mockDisclosure, movementLine } from "@/lib/org/briefing";
import type { ExecBriefing } from "@/lib/org/briefing";

export function ExecutiveSignalsStrip({ briefing }: { briefing: ExecBriefing }) {
  if (
    briefing.adoptionRate == null &&
    briefing.movement.compared === 0 &&
    briefing.benchmark?.cohort?.overallPercentile == null &&
    briefing.engineMix.length === 0 &&
    briefing.mockCount === 0
  ) {
    return null;
  }
  const { benchmark } = briefing;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 type-mono-sm text-slate-500">
      {briefing.adoptionRate != null && (
        <span>
          Fleet adoption <span className="text-slate-300">{briefing.adoptionRate}%</span> at high-adoption posture
        </span>
      )}
      {/* Direction 2 — the composed line (G12), not a hand-rolled "{up+down} of {compared} repos
          moved". The inlined copy dropped the "(of N live-scored)" subset clause the composer
          carries, which is the whole point of UAT DANA-L1-012: this denominator is a SUBSET of the
          one the tiles above are averaged over, and unlabelled it invites the reader to reconcile
          two counts that were never meant to add up. */}
      {movementLine(briefing.movement, briefing.realScoredCount) && (
        <span className="text-slate-400">{movementLine(briefing.movement, briefing.realScoredCount)}</span>
      )}
      {benchmark?.cohort?.overallPercentile != null && (
        <span>
          Peer cohort <span className="text-slate-300">{benchmark.cohort.overallPercentile}th percentile</span> vs{" "}
          {benchmark.cohort.repos} {benchmark.cohort.language} repos
          {benchmark.cohort.adoptionPercentile != null ? ` · ${benchmark.cohort.adoptionPercentile}th on AI adoption` : ""}
        </span>
      )}
      {/* Direction 1 — the mock disclosure, from the ONE composer (G12). Deliberately NOT folded into
          the engine-mix caveat beside it: that caveat counts scans that RAN in the window, while the
          averages read each repo's latest scan at-or-before the upper bound, so a fleet whose mock
          scans predate the window gets no caveat and still has a shrunken denominator. */}
      {mockDisclosure(briefing) && <span className="text-warn">⚠ {mockDisclosure(briefing)}</span>}
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
