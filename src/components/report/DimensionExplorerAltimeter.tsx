"use client";

// Variant: ALTIMETER — the climb, literally. Instead of a radar (nine spokes on a circle, which
// reads "shape" but not "height") the nine dimensions stand on one elevation gauge whose strata are
// the five maturity bands. Selection is spatial (click or arrow across the climbers); the reading
// card to the side translates the selected height into rungs: level, points to the next band,
// weight, overall points in reach, since-last movement. The detail body below is the shared one.

import { useState } from "react";
import type { DimensionId, ScanReport } from "@/lib/types";
import { scoreHex } from "@/lib/ui";
import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import type { TrendPoint } from "@/components/report/TrendChart";
import { DimensionDetail } from "@/components/report/DimensionDetail";
import { AltimeterGauge } from "@/components/report/AltimeterGauge";
import { dimFacts, explorerSummary } from "@/components/report/dimensionExplorerDerive";
import { EmptyState } from "@/components/EmptyState";
import { Kicker, SectionHeading, Stat, Surface, deltaHex, fmtDelta } from "@/components/ui";

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

  return (
    <section aria-label="Dimensions" data-testid="report-tab-dimensions" className="space-y-6">
      <SectionHeading
        kicker="Dimension breakdown"
        kickerTone="accent"
        title="Elevation by dimension"
        intro="Nine weighted dimensions on one gauge. The bands are the maturity levels; each rope climbs to its score, the hollow marker is where the last scan left it. Pick a climber to read its evidence."
        right={
          <Kicker tone="muted">
            {summary.atL4}/{facts.length} at Integrated or above
          </Kicker>
        }
      />

      <Surface tone="strong" className="strata relative overflow-hidden px-2 pb-2 pt-3 sm:px-4">
        <AltimeterGauge facts={facts} selectedId={sel.id} onSelect={setSelectedId} mounted={mounted} reduced={reduced} />
        <p className="border-t border-divider px-2 pt-3 type-body-sm text-slate-300">{summary.line}</p>
      </Surface>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,280px)_1fr]">
        {/* The reading — the selected climber's height translated into rungs. Keyed so it fades on
            every pick alongside the detail. */}
        <Surface radius="2xl" className="p-5">
          <div key={sel.id} className="animate-fade-in space-y-4">
            <Stat
              variant="figure"
              label={`${sel.id} · ${sel.short}`}
              value={sel.d.score}
              color={scoreHex(sel.d.score)}
              delta={sel.delta}
              deltaLabel={sel.delta !== null ? "since last scan" : undefined}
            />
            <dl className="space-y-2 border-t border-divider pt-4 type-body-sm">
              <Reading label="Level" value={`${sel.level.id} ${sel.level.name}`} color={scoreHex(sel.d.score)} />
              <Reading
                label="Next rung"
                value={sel.next ? `+${sel.toNext} to ${sel.next.id} ${sel.next.name}` : "at the summit"}
              />
              <Reading label="Weight" value={`${Math.round(sel.d.weight * 100)}% · ${sel.axis}`} />
              <Reading
                label="In reach"
                value={`+${sel.headroom.toFixed(1)} overall pts`}
                color={sel.headroom > 0 ? deltaHex(sel.headroom) : undefined}
              />
              {sel.delta !== null && <Reading label="Moved" value={fmtDelta(sel.delta)} color={deltaHex(sel.delta)} />}
            </dl>
          </div>
        </Surface>

        <Surface radius="2xl" className="p-5">
          <div key={sel.id} className="animate-fade-in">
            <DimensionDetail
              d={sel.d}
              prevScore={prevDimScores?.get(sel.id)}
              series={dimSeries?.get(sel.id)}
              integrity={report.scoreIntegrity}
            />
          </div>
        </Surface>
      </div>
    </section>
  );
}

function Reading({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="type-label tracking-[0.18em] text-slate-500">{label}</dt>
      <dd className="font-mono tabular-nums text-slate-200" style={color ? { color } : undefined}>
        {value}
      </dd>
    </div>
  );
}
