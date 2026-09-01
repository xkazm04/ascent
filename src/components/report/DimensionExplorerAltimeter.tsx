"use client";

// Variant: ALTIMETER (round 2, fused). The climb, literally: the nine dimensions stand on one
// elevation gauge whose strata are the five maturity bands, with a hollow marker where the last scan
// left each one. Under it, the index half (fused in from the Ledger direction): a climber list with
// the weighted headroom lever, the since-last delta and a sort that re-orders gauge and list together
// (sort by score = a skyline). The detail carries a reading strip — level, next rung, in reach, and
// the model-vs-detectors readout kept from the Mirror direction — over the shared evidence body.

import { useState } from "react";
import type { DimensionId, ScanReport } from "@/lib/types";
import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import type { TrendPoint } from "@/components/report/TrendChart";
import { DimensionDetail } from "@/components/report/DimensionDetail";
import { AltimeterGauge } from "@/components/report/AltimeterGauge";
import { DimensionClimberList, sortClimbers, type ClimberSort } from "@/components/report/DimensionClimberList";
import { DimensionReading } from "@/components/report/DimensionReading";
import { dimFacts, explorerSummary } from "@/components/report/dimensionExplorerDerive";
import { EmptyState } from "@/components/EmptyState";
import { Kicker, SectionHeading, Surface } from "@/components/ui";

export function DimensionExplorerAltimeter({
  report,
  prevDimScores,
  dimSeries,
}: {
  report: ScanReport;
  prevDimScores: Map<string, number> | null;
  dimSeries: Map<string, TrendPoint[]> | null;
}) {
  const facts = report.dimensions.map((d) => dimFacts(d, prevDimScores?.get(d.id), report.scoreIntegrity));
  const [selectedId, setSelectedId] = useState<DimensionId | null>(facts[0]?.id ?? null);
  const [sort, setSort] = useState<ClimberSort>("rubric");
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const summary = explorerSummary(facts);
  const sel = facts.find((f) => f.id === selectedId) ?? facts[0];

  if (!sel || !summary) {
    return (
      <section aria-label="Dimensions" data-testid="report-tab-dimensions">
        <EmptyState variant="section" title="No dimensions were scored" body="Nothing could be measured on this scan." />
      </section>
    );
  }

  const ordered = sortClimbers(facts, sort);

  return (
    <section aria-label="Dimensions" data-testid="report-tab-dimensions" className="space-y-6">
      <SectionHeading
        kicker="Dimension breakdown"
        kickerTone="accent"
        title="Elevation by dimension"
        intro="Nine weighted dimensions on one gauge. The bands are the maturity levels; each rope climbs to its score and the hollow marker is where the last scan left it. Pick a climber to read its evidence."
        right={
          <Kicker tone="muted">
            {summary.atL4}/{facts.length} at Integrated or above
          </Kicker>
        }
      />

      <Surface tone="strong" className="strata relative overflow-hidden px-2 pb-2 pt-3 sm:px-4">
        <AltimeterGauge facts={ordered} selectedId={sel.id} onSelect={setSelectedId} mounted={mounted} reduced={reduced} />
        <p className="border-t border-divider px-2 pt-3 type-body-sm text-slate-300">{summary.line}</p>
      </Surface>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <DimensionClimberList facts={ordered} selectedId={sel.id} onSelect={setSelectedId} sort={sort} onSort={setSort} mounted={mounted} reduced={reduced} />

        {/* Keyed on the selection so reading + detail cross-fade in on every pick. */}
        <div key={sel.id} className="animate-fade-in space-y-4">
          <DimensionReading f={sel} />
          <Surface radius="2xl" className="p-5">
            <DimensionDetail d={sel.d} prevScore={prevDimScores?.get(sel.id)} series={dimSeries?.get(sel.id)} integrity={report.scoreIntegrity} />
          </Surface>
        </div>
      </div>
    </section>
  );
}
