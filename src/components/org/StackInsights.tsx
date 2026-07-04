// The tech-stacks "Dimension analysis" section — headline tiles (fleet spread · systemic gaps ·
// shared strengths · widest divergence) over one combined board: every dimension diagnosed, and each
// divergent / systemic-gap row expands in place to reveal its transformation playbook (moves, a
// Practices artifact, a Plan goal). Server-safe: computes the insights once, passes them to the
// client board (AnalysisPlaybookBoard) which owns the expand state.

import { Card, SectionHeader, Tile, TILE_GRID } from "@/components/org/ui";
import type { SegmentSummary } from "@/lib/db";
import { computeFleetInsights, type DimInsight } from "./fleetAnalysis";
import { AnalysisPlaybookBoard } from "./AnalysisPlaybookBoard";
import type { AnalysisScope } from "./analysisScope";

export function StackInsights({ org, stacks, fleet, dims, scope }: {
  org: string; stacks: SegmentSummary[]; fleet: SegmentSummary | null; dims: string[]; scope: AnalysisScope;
}) {
  const ins = computeFleetInsights(stacks, fleet, dims);
  if (!ins) {
    return <p className="mt-3 text-sm text-slate-500">Scan at least two {scope.nounPlural} to compare their dimension profiles.</p>;
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
        <Tile label="Systemic gaps" value={ins.gaps.length} sub={labels(ins.gaps)} color={ins.gaps.length ? "#f97316" : undefined} />
        <Tile label="Shared strengths" value={ins.strengths.length} sub={labels(ins.strengths)} color={ins.strengths.length ? "#22c55e" : undefined} />
        <Tile
          label="Widest divergence"
          value={ins.widest ? `${ins.widest.label} Δ${ins.widest.spread}` : "—"}
          sub={ins.widest ? `${ins.widest.leader.name} vs ${ins.widest.laggard.name}` : ""}
          color={ins.widest && ins.widest.spread >= 35 ? "#eab308" : undefined}
        />
      </div>

      <Card>
        <SectionHeader
          size="sm"
          title="Consensus & transfer plan"
          description="Every dimension diagnosed, most-actionable first. Expand a divergent or systemic-gap row for its transformation playbook — the moves, a Practices artifact, and a goal to own in Plan."
        />
        <div className="mt-3">
          <AnalysisPlaybookBoard org={org} dims={ins.dims} scope={scope} />
        </div>
        <p className="mt-3 font-mono text-xs text-slate-500">
          hollow dot = laggard · filled dot = leader · vertical line = whole-fleet baseline · bar = spread
        </p>
      </Card>
    </div>
  );
}
