// The tech-stacks dimension analysis, Prism composition: four figures (fleet spread, systemic gaps, shared
// strengths, widest divergence) in a ruled row, then the consensus and transfer plan in a Frame. Same
// computeFleetInsights, same wording for every figure as StackInsights. Server-safe.
import { Caption, Display, Frame, SectionHead } from "@/components/kit";
import { Legend, STATE_LABEL } from "@/components/org/viz";
import type { SegmentSummary } from "@/lib/db";
import { computeFleetInsights, type DimInsight } from "./fleetAnalysis";
import { RANGE_LEGEND_EXTRA } from "./rangeLegend";
import { AnalysisPlaybookBoardV2 } from "./AnalysisPlaybookBoard.v2";
import { SectionHelp } from "./SectionHelp";
import type { AnalysisScope } from "./analysisScope";

function Figure({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="min-w-0">
      <Caption>{label}</Caption>
      <Display as="div" level="figure" className="mt-1">
        {value}
      </Display>
      {sub && <div className="mt-1 type-caption text-slate-400">{sub}</div>}
    </div>
  );
}

export function StackInsightsV2({ org, stacks, fleet, dims, scope }: { org: string; stacks: SegmentSummary[]; fleet: SegmentSummary | null; dims: string[]; scope: AnalysisScope }) {
  const ins = computeFleetInsights(stacks, fleet, dims);
  if (!ins) {
    return <p className="mt-4 type-body-sm text-slate-300">Scan at least two {scope.nounPlural} to compare their dimension profiles.</p>;
  }
  const labels = (arr: DimInsight[]) => (arr.length ? arr.map((d) => d.label).join(" · ") : "none");
  return (
    <div className="mt-5 space-y-8">
      <div className="grid gap-x-10 gap-y-5 border-y border-divider py-5 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Fleet spread"
          value={ins.overall ? `${ins.overall.spread} pts` : "aligned"}
          sub={ins.overall ? `${ins.overall.leader.name} → ${ins.overall.laggard.name}` : "every stack level"}
        />
        <Figure label="Systemic gaps" value={ins.gaps.length} sub={labels(ins.gaps)} />
        <Figure label="Shared strengths" value={ins.strengths.length} sub={labels(ins.strengths)} />
        <Figure
          label="Widest divergence"
          // No widest means no dimension had two scored stacks to compare: an absence, said in words.
          value={ins.widest ? `${ins.widest.label} Δ${ins.widest.spread}` : STATE_LABEL["not-judged"]}
          sub={ins.widest ? `${ins.widest.leader.name} vs ${ins.widest.laggard.name}` : `no dimension has two scored ${scope.nounPlural}`}
        />
      </div>
      <Frame aria-label="Consensus and transfer plan">
        <div className="flex items-start gap-3">
          <SectionHead eyebrow="Consensus" title="Every dimension diagnosed," named="most actionable first." level="named" as="h3" />
          <SectionHelp label="How to read the consensus & transfer plan">
            Every dimension diagnosed across the {ins.scoredCount} scored {scope.nounPlural}, most-actionable first. Each row states how many of them its
            verdict rests on: a dimension only a minority can evidence is de-weighted, not hidden. Expand a divergent or systemic-gap row for its
            transformation playbook (the moves, a Practices artifact, and the gaps to work in Proposals).
          </SectionHelp>
        </div>
        <div className="mt-4">
          <AnalysisPlaybookBoardV2 org={org} dims={ins.dims} scope={scope} />
        </div>
        <Legend className="mt-3" extra={RANGE_LEGEND_EXTRA} />
      </Frame>
    </div>
  );
}
