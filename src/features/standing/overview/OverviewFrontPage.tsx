"use client";

// FRONT PAGE — the Overview as the front page of an index report.
//
// Metaphor: a masthead. The page LEADS with one typeset standing figure and a one-sentence takeaway
// derived from the data ("Augmented at 62, climbing. Testing owes first."), sets the movers as a
// short column beside it, prints the punch-list (the owed dimensions, weakest first) under a rule,
// and folds everything the baseline showed at headline weight — the nine-row ledger, the cohort
// rollup, the heatmap — into a contents index of disclosures one click below.
//
// Differs from the baseline in what it DELETES: four equal badges become one figure; the legend
// chips become a sentence; three same-weight panels become three summarised rows. Same data, one
// editor. Client component only because the switcher and disclosures hold state.

import { Dateline, Surface } from "@/components/ui";
import { DIMS, SectionEmpty } from "@/components/org/shared/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { OverviewLedgerData } from "./OverviewLedger";
import { buildDimensionReadings } from "./dimensionReading";
import { fixFirstDims, pickMovers, standingOf, takeawayOf } from "./overviewTakeaway";
import { OverviewFrontPageMasthead } from "./OverviewFrontPageMasthead";
import { OverviewFrontPageFixRows } from "./OverviewFrontPageFixRows";
import { OverviewMovers } from "./OverviewMovers";
import { OverviewPostureLine } from "./OverviewPostureLine";
import { OverviewDisclosure } from "./OverviewDisclosure";
import { LedgerDimensionRows } from "./LedgerDimensionRows";
import { RepoCategoryRollup } from "./RepoCategoryRollup";
import { RepoDimensionHeatmap } from "./RepoDimensionHeatmap";
import { summarize } from "./repoTrajectory";

export function OverviewFrontPage(d: OverviewLedgerData) {
  const readings = buildDimensionReadings(d.dims, d.dimDeltas, d.heatmapRows, d.deltaLabel);
  const standing = standingOf(d.badges);
  const takeaway = takeawayOf(standing, readings);
  const dateline = <Dateline left={`Standing · ${d.periodTitle}`} right={`${standing.scanned} of ${standing.repos} repos scanned`} />;

  // Zero state: repos exist but none has a scan in this view. The masthead still prints — it says
  // what to do — and nothing below it pretends to be a reading.
  if (standing.overall === null) {
    return (
      <Surface className="animate-fade-up px-6 pb-6 pt-5">
        {dateline}
        <p className="type-lede mt-5 text-slate-100">
          {takeaway.lead} <span className="text-slate-400">{takeaway.action}</span>
        </p>
        <div className="mt-5">
          <SectionEmpty>
            No scanned repository in this period. Widen the time range, or scan from the{" "}
            <a href={orgTabHref(d.slug, "repositories")} className="focus-ring rounded text-accent hover:text-accent-soft">
              Repositories tab →
            </a>
          </SectionEmpty>
        </div>
      </Surface>
    );
  }

  const movers = pickMovers(d.trajectories);
  const fixes = fixFirstDims(readings);
  const owed = readings.filter((r) => r.owed).length;
  const fleet = summarize(d.trajectories);

  return (
    <div className="animate-fade-up space-y-4">
      <Surface className="px-6 pb-6 pt-5">
        {dateline}
        <div className="mt-5 grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div>
            <OverviewFrontPageMasthead standing={standing} takeaway={takeaway} trend={d.trend} slug={d.slug} search={d.search} deltaLabel={d.deltaLabel} />
            <OverviewPostureLine slug={d.slug} postureCounts={d.postureCounts} search={d.search} className="mt-5" />
          </div>
          <div className="lg:border-l lg:border-divider lg:pl-8">
            <div className="flex items-baseline justify-between gap-3">
              <span className="type-label tracking-[0.22em] text-slate-500">Movers</span>
              <span className="type-caption tabular-nums text-slate-500">
                {movers.moved} of {d.trajectories.length} moved {d.deltaLabel}
              </span>
            </div>
            <OverviewMovers movers={movers} orgSlug={d.slug} deltaLabel={d.deltaLabel} />
          </div>
        </div>
        <OverviewFrontPageFixRows fixes={fixes} owed={owed} total={readings.length} slug={d.slug} className="mt-6 border-t border-divider pt-5" />
      </Surface>

      {/* The contents index: every detail the baseline printed at headline weight, one click down. */}
      <Surface className="px-6">
        <OverviewDisclosure label="All dimensions by phase" summary={`${readings.length} dimensions · ${owed} owe a follow-up`}>
          <LedgerDimensionRows slug={d.slug} readings={readings} search={d.search} />
        </OverviewDisclosure>
        <div data-tour="results-view">
          <OverviewDisclosure label="Fleet by cohort" summary={`${fleet.repos} repos · ▲${fleet.improving} ▼${fleet.slipping} →${fleet.holding}`}>
            <RepoCategoryRollup trajectories={d.trajectories} periodTitle={d.periodTitle} orgSlug={d.slug} />
          </OverviewDisclosure>
        </div>
        <OverviewDisclosure
          id="heatmap"
          label="Repo × dimension heatmap"
          summary={`${d.heatmapRows.length} repos × ${DIMS.length} dimensions`}
          defaultOpen={Boolean(d.sortDim)}
        >
          <RepoDimensionHeatmap org={d.slug} dims={DIMS} rows={d.heatmapRows} initialSortDim={d.sortDim} />
        </OverviewDisclosure>
      </Surface>
    </div>
  );
}
