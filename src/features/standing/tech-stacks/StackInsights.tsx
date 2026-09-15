// The tech-stacks "Dimension analysis" section — headline tiles (fleet spread · systemic gaps ·
// shared strengths · widest divergence) over one combined board: every dimension diagnosed, and each
// divergent / systemic-gap row expands in place to reveal its transformation playbook (moves, a
// Practices artifact, a Plan goal). Server-safe: computes the insights once, passes them to the
// client board (AnalysisPlaybookBoard) which owns the expand state.

import { Card, SectionHeader, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { Legend, STATE_LABEL } from "@/components/org/viz";
import { CLASS_META } from "@/features/standing/tech-stacks/analysisShared";
import { RANGE_LEGEND_EXTRA } from "@/features/standing/tech-stacks/rangeLegend";
import type { SegmentSummary } from "@/lib/db";
import { computeFleetInsights, type DimInsight } from "@/features/standing/tech-stacks/fleetAnalysis";
import { AnalysisPlaybookBoard } from "@/features/standing/tech-stacks/AnalysisPlaybookBoard";
import { SectionHelp } from "@/features/standing/tech-stacks/SectionHelp";
import type { AnalysisScope } from "@/features/standing/tech-stacks/analysisScope";

export function StackInsights({ org, stacks, fleet, dims, scope }: {
  org: string; stacks: SegmentSummary[]; fleet: SegmentSummary | null; dims: string[]; scope: AnalysisScope;
}) {
  const ins = computeFleetInsights(stacks, fleet, dims);
  if (!ins) {
    return <p className="mt-3 type-body-sm text-slate-500">Scan at least two {scope.nounPlural} to compare their dimension profiles.</p>;
  }
  const labels = (arr: DimInsight[]) => (arr.length ? arr.map((d) => d.label).join(" · ") : "none");

  return (
    <div className="mt-3 space-y-5">
      <div className={TILE_GRID}>
        <Tile
          label="Fleet spread"
          value={ins.overall ? `${ins.overall.spread} pts` : "aligned"}
          sub={ins.overall ? `${ins.overall.leader.name} → ${ins.overall.laggard.name}` : "every stack level"}
        />
        <Tile label="Systemic gaps" value={ins.gaps.length} sub={labels(ins.gaps)} color={ins.gaps.length ? CLASS_META.gap.color : undefined} />
        <Tile label="Shared strengths" value={ins.strengths.length} sub={labels(ins.strengths)} color={ins.strengths.length ? CLASS_META.strength.color : undefined} />
        <Tile
          label="Widest divergence"
          // No widest means no dimension had two scored stacks to compare — an absence, so it says so
          // rather than printing the em dash a reader is free to read as "zero divergence".
          value={ins.widest ? `${ins.widest.label} Δ${ins.widest.spread}` : STATE_LABEL["not-judged"]}
          sub={ins.widest ? `${ins.widest.leader.name} vs ${ins.widest.laggard.name}` : `no dimension has two scored ${scope.nounPlural}`}
          color={ins.widest && ins.widest.spread >= 35 ? CLASS_META.divergent.color : undefined}
        />
      </div>

      <Card>
        {/* The explanation lives behind the "?" beside the title, not as a paragraph under it: this
            board is scanned far more often than it is explained, and four lines of preamble pushed
            the first diagnosis row down every single visit. */}
        <div className="flex items-center gap-2">
          <SectionHeader size="sm" title="Consensus & transfer plan" />
          <SectionHelp label="How to read the consensus & transfer plan">
            Every dimension diagnosed across the {ins.scoredCount} scored {scope.nounPlural}, most-actionable
            first. Each row states how many of them its verdict rests on: a dimension only a minority can
            evidence is de-weighted, not hidden. Expand a divergent or systemic-gap row for its
            transformation playbook (the moves, a Practices artifact, and the gaps to work in Follow-ups).
          </SectionHelp>
        </div>
        <div className="mt-3">
          <AnalysisPlaybookBoard org={org} dims={ins.dims} scope={scope} />
        </div>
        {/* The four marks, as the marks. The n/N clause that used to close this line is not here on
            purpose: CoverageChip already carries it as its own title on the chip itself — the exact
            affordance the sentence described — so repeating it would be the same fact twice. */}
        <Legend className="mt-3" extra={RANGE_LEGEND_EXTRA} />
      </Card>
    </div>
  );
}
