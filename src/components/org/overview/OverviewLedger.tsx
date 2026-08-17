"use client";

// The Overview's data region — the org overview as an editorial LEDGER (the direction that won the
// 2026-08-17 prototype round; the "Instrument" cockpit variant and the pre-redesign baseline were
// deleted with the switcher).
//
// Mental model: the front page of an index report. One column, hairline rules, mono figures on the
// right, and every line item says what it is, what it means, and where it leads. In reading order:
//   1. the standing strip (four numbers + the maturity trend sparkline),
//   2. posture composition (one bar of true shares, each segment a filtered deep link),
//   3. the dimensions as a LEDGER grouped by SDLC phase (LedgerDimensionRows) — status word,
//      one-line reading, and two NAMED affordances per row,
//   4. the fleet cohort rollup (Type / Stack / Level, level-ordered),
//   5. the repo × dimension heatmap.
//
// Client component because the fleet rollup and heatmap hold interaction state; every prop is
// serialisable and derived ONCE on the server in OverviewFleetPanel — nothing here awaits.

import { Card, DIMS, SectionHeader } from "@/components/org/shared/ui";
import { FOLLOW_UP_BELOW } from "@/lib/maturity/model";
import type { ScoreBadge } from "./OrgScoreBadges";
import type { TrendPoint } from "@/components/report/TrendChart";
import type { HeatRow } from "./RepoDimensionHeatmap";
import type { RepoTrajectory } from "./repoTrajectory";
import { OrgScoreBadges } from "./OrgScoreBadges";
import { PostureCompositionBar } from "./PostureCompositionBar";
import { LedgerDimensionRows } from "./LedgerDimensionRows";
import { RepoCategoryRollup } from "./RepoCategoryRollup";
import { RepoDimensionHeatmap } from "./RepoDimensionHeatmap";
import { buildDimensionReadings } from "./dimensionReading";

/** Everything the Overview renders from — serialisable, derived once on the server. */
export interface OverviewLedgerData {
  slug: string;
  /** The tab's current query string, threaded into deep links so scope survives a jump. */
  search: string;
  periodTitle: string;
  sortDim?: string;
  badges: ScoreBadge[];
  trend: { points: TrendPoint[]; label: string };
  postureCounts: Record<string, number>;
  dims: { dimId: string; avg: number }[];
  dimDeltas: { dimId: string; delta: number }[] | null;
  deltaLabel: string;
  trajectories: RepoTrajectory[];
  heatmapRows: HeatRow[];
}

export function OverviewLedger(d: OverviewLedgerData) {
  const readings = buildDimensionReadings(d.dims, d.dimDeltas, d.heatmapRows, d.deltaLabel);
  const owed = readings.filter((r) => r.owed).length;
  const scored = Object.values(d.postureCounts).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-6">
      <OrgScoreBadges badges={d.badges} trend={d.trend} />

      <Card>
        <SectionHeader
          size="sm"
          title="Posture distribution"
          right={<span className="font-mono text-sm text-slate-500">{scored} scored</span>}
        />
        <PostureCompositionBar slug={d.slug} postureCounts={d.postureCounts} search={d.search} />

        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-3 border-t border-divider pt-4">
          <div>
            <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">Dimensions by SDLC phase</span>
            <p className="mt-0.5 text-sm text-slate-500">
              {owed === 0
                ? "Every dimension is in the green band."
                : `${owed} of ${readings.length} dimensions still owe a follow-up (below ${FOLLOW_UP_BELOW}). Each row names the practice that lifts it and the repos it touches.`}
            </p>
          </div>
        </div>
        <LedgerDimensionRows slug={d.slug} readings={readings} search={d.search} />
      </Card>

      <div data-tour="results-view">
        <RepoCategoryRollup trajectories={d.trajectories} periodTitle={d.periodTitle} orgSlug={d.slug} />
      </div>

      {/* Cells open the per-dimension modal. The `#heatmap` anchor is the target of every ledger
          row's ▦ affordance above. */}
      {d.heatmapRows.length > 0 && (
        <div id="heatmap" className="scroll-mt-24">
          <RepoDimensionHeatmap org={d.slug} dims={DIMS} rows={d.heatmapRows} initialSortDim={d.sortDim} />
        </div>
      )}
    </div>
  );
}
