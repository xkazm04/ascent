"use client";

// The Overview's data region — the org overview as an editorial LEDGER (the direction that won the
// 2026-08-17 prototype round; the "Instrument" cockpit variant and the pre-redesign baseline were
// deleted with the switcher).
//
// Mental model: the front page of an index report. One column, hairline rules, mono figures on the
// right, and every line item says what it is, what it means, and where it leads. In reading order:
//   1. the standing strip (four numbers + the maturity trend sparkline), and beside it the fleet
//      trajectory card (where the trend is heading) when the fit is presentable,
//   2. posture composition (one bar of true shares, each segment a filtered deep link),
//   3. the dimensions as a LEDGER grouped by SDLC phase (LedgerDimensionRows) — status word,
//      one-line reading, and two NAMED affordances per row,
//   4. the fleet cohort rollup (Type / Stack / Level, level-ordered),
//   5. the repo × dimension heatmap.
//
// Client component because the fleet rollup and heatmap hold interaction state; every prop is
// serialisable and derived ONCE on the server in OverviewFleetPanel — nothing here awaits.

import { Card, DIMS, SectionHeader } from "@/components/org/shared/ui";
import { Legend, type VizState } from "@/components/org/viz";
import type { Forecast } from "@/lib/maturity/forecast";
import type { ScoreBadge } from "./OrgScoreBadges";
import type { TrendPoint } from "@/components/report/TrendChart";
import type { HeatRow } from "./RepoDimensionHeatmap";
import type { RepoTrajectory } from "./repoTrajectory";
import { OrgScoreBadges } from "./OrgScoreBadges";
import { OverviewTrajectoryCard } from "./OverviewTrajectoryCard";
import { PostureCompositionBar } from "./PostureCompositionBar";
import { LedgerDimensionRows } from "./LedgerDimensionRows";
import { RepoCategoryRollup } from "./RepoCategoryRollup";
import { RepoDimensionHeatmap } from "./RepoDimensionHeatmap";
import { buildDimensionReadings } from "./dimensionReading";
import { PhaseStandingStrip } from "./PhaseStandingStrip";
import { GREEN_FLOOR, owedCount, phaseStandings } from "./phaseStanding";

// Kit order, filtered to the states the strip actually draws.
const KIT_ORDER: VizState[] = ["measured", "not-judged", "missing"];

/** Everything the Overview renders from — serialisable, derived once on the server. */
export interface OverviewLedgerData {
  slug: string;
  /** The tab's current query string, threaded into deep links so scope survives a jump. */
  search: string;
  periodTitle: string;
  sortDim?: string;
  badges: ScoreBadge[];
  trend: { points: TrendPoint[]; label: string };
  /** The rollup's forward-looking fit over the maturity trend. Already computed on the landing path;
   *  the card gates it on presentability and renders nothing below the gate. */
  forecast: Forecast | null;
  postureCounts: Record<string, number>;
  dims: { dimId: string; avg: number }[];
  dimDeltas: { dimId: string; delta: number }[] | null;
  deltaLabel: string;
  trajectories: RepoTrajectory[];
  heatmapRows: HeatRow[];
}

export function OverviewLedger(d: OverviewLedgerData) {
  const readings = buildDimensionReadings(d.dims, d.dimDeltas, d.heatmapRows, d.deltaLabel);
  const owed = owedCount(readings);
  const phases = phaseStandings(readings);
  const phaseStates = KIT_ORDER.filter((st) => phases.some((p) => p.state === st));
  const scored = Object.values(d.postureCounts).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-6">
      <OrgScoreBadges badges={d.badges} trend={d.trend} />

      {/* Where the fleet is HEADING, beside where it stands. Self-gating: renders nothing when the
          fit is not presentable, so the strip closes up on a thin-history org. */}
      <OverviewTrajectoryCard forecast={d.forecast} />

      <Card>
        <SectionHeader
          size="sm"
          title="Posture distribution"
          right={<span className="type-mono-sm text-slate-500">{scored} scored</span>}
        />
        <PostureCompositionBar slug={d.slug} postureCounts={d.postureCounts} search={d.search} />

        {/* The phase strip is the FIRST SIGHT of the dimension section: three bars against the green
            floor say which part of the pipeline carries the debt, which the sentence this replaced
            counted ("N of 9 ... below 65") without ever locating. The count survives as a scope
            readout beside the rule — a number, not a claim. */}
        <div className="mt-5 border-t border-divider pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="type-body-sm font-semibold uppercase tracking-wide text-slate-500">Dimensions by SDLC phase</span>
            <span className="type-mono-sm tabular-nums text-slate-500">
              {owed.n} of {owed.of} below green {GREEN_FLOOR}
            </span>
          </div>
          <PhaseStandingStrip phases={phases} className="mt-3 max-w-3xl" />
          <Legend states={phaseStates} className="mt-2" />
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
