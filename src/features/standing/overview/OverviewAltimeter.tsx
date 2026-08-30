"use client";

// ALTIMETER — the Overview as an instrument panel.
//
// Metaphor: an elevation reading. The fleet's standing is an ALTITUDE on a vertical gauge whose
// strata are the five maturity levels (L1 Manual at the bottom, L5 Autonomous at the top); the
// needle sits at today's average and a ghost mark shows where it was a period ago. The nine
// dimensions are nine smaller gauges on the same scale, grouped by SDLC phase, each with its own
// needle movement (the delta drawn as a stroke from "was" to "is"). The movers are the Δ log; the
// heatmap, cohorts and full ledger are readouts behind the panel.
//
// Differs from the Front page in WHERE the eye goes: position on a scale, not prose. The same
// takeaway sentence is printed beside the needle, but a reader can answer "how high, which way,
// which dimension is lowest" from the geometry alone. Client component: switcher + disclosures.

import { Surface } from "@/components/ui";
import { DIMS, Meter, SectionEmpty } from "@/components/org/shared/ui";
import { deltaHex, fmtDelta } from "@/components/ui/format";
import { orgTabHref } from "@/lib/org/orgTabs";
import { scoreHex } from "@/lib/ui";
import type { OverviewLedgerData } from "./OverviewLedger";
import { buildDimensionReadings } from "./dimensionReading";
import { pickMovers, standingOf, takeawayOf } from "./overviewTakeaway";
import { fixHref } from "./OverviewFrontPageMasthead";
import { OverviewAltimeterGauge } from "./OverviewAltimeterGauge";
import { OverviewAltimeterDials } from "./OverviewAltimeterDials";
import { OverviewMovers } from "./OverviewMovers";
import { OverviewPostureLine } from "./OverviewPostureLine";
import { OverviewDisclosure } from "./OverviewDisclosure";
import { LedgerDimensionRows } from "./LedgerDimensionRows";
import { RepoCategoryRollup } from "./RepoCategoryRollup";
import { RepoDimensionHeatmap } from "./RepoDimensionHeatmap";
import Link from "next/link";

export function OverviewAltimeter(d: OverviewLedgerData) {
  const readings = buildDimensionReadings(d.dims, d.dimDeltas, d.heatmapRows, d.deltaLabel);
  const s = standingOf(d.badges);
  const takeaway = takeawayOf(s, readings);

  if (s.overall === null) {
    return (
      <Surface tone="strong" className="strata animate-fade-up relative overflow-hidden p-6">
        <span className="type-label tracking-[0.22em] text-slate-500">Elevation · {d.periodTitle}</span>
        <p className="type-lede mt-3 text-slate-100">
          {takeaway.lead} <span className="text-slate-400">{takeaway.action}</span>
        </p>
        <div className="mt-5">
          <SectionEmpty>
            No scanned repository in this period — the gauge has nothing to read. Widen the range, or scan from the{" "}
            <a href={orgTabHref(d.slug, "repositories")} className="focus-ring rounded text-accent hover:text-accent-soft">
              Repositories tab →
            </a>
          </SectionEmpty>
        </div>
      </Surface>
    );
  }

  const movers = pickMovers(d.trajectories);
  const owed = readings.filter((r) => r.owed).length;
  const color = scoreHex(s.overall);

  return (
    <div className="animate-fade-up space-y-4">
      <Surface tone="strong" className="strata relative overflow-hidden p-6">
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,3fr)_minmax(0,2fr)]">
          <OverviewAltimeterGauge overall={s.overall} delta={s.delta} />

          {/* The reading beside the needle. */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="type-label tracking-[0.22em] text-slate-500">Elevation · {d.periodTitle}</span>
              <span className="type-caption tabular-nums text-slate-500">
                {s.scanned} of {s.repos} repos scanned
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="type-figure-lg font-bold" style={{ color }}>
                {s.overall}
              </span>
              <span className="type-title font-semibold text-white">{s.levelName}</span>
              <span className="type-label tracking-[0.22em] text-slate-500">{s.levelId}</span>
              {s.delta !== null ? (
                <span className="type-mono-sm tabular-nums" style={{ color: deltaHex(s.delta) }}>
                  {fmtDelta(s.delta)} <span className="text-slate-500">{d.deltaLabel}</span>
                </span>
              ) : (
                <span className="type-caption text-slate-500">no baseline {d.deltaLabel}</span>
              )}
            </div>
            <p className="type-lede mt-2 text-slate-100">
              {takeaway.lead}{" "}
              {takeaway.fix ? (
                <Link href={fixHref(d.slug, d.search, takeaway.fix)} className="focus-ring rounded text-accent transition hover:text-accent-soft">
                  {takeaway.action} →
                </Link>
              ) : (
                <span className="text-slate-400">{takeaway.action}</span>
              )}
            </p>
            <dl className="mt-4 grid max-w-md gap-y-2">
              {[
                ["AI adoption", s.adoption],
                ["Engineering rigor", s.rigor],
              ].map(([label, v]) =>
                typeof v === "number" ? (
                  <div key={String(label)} className="grid grid-cols-[8.5rem_minmax(0,1fr)_2.5rem] items-center gap-x-3">
                    <dt className="type-caption text-slate-400">{label}</dt>
                    <dd>
                      <Meter value={v} color={scoreHex(v)} size="sm" ariaLabel={`${label} ${v}`} />
                    </dd>
                    <dd className="type-mono-sm text-right font-semibold tabular-nums" style={{ color: scoreHex(v) }}>
                      {v}
                    </dd>
                  </div>
                ) : null,
              )}
            </dl>
            <OverviewPostureLine slug={d.slug} postureCounts={d.postureCounts} search={d.search} className="mt-4 max-w-md" />
          </div>

          {/* Δ log */}
          <div className="min-w-0 md:col-span-2 lg:col-span-1 lg:border-l lg:border-divider lg:pl-8">
            <div className="flex items-baseline justify-between gap-3">
              <span className="type-label tracking-[0.22em] text-slate-500">Δ log</span>
              <span className="type-caption tabular-nums text-slate-500">
                {movers.moved} of {d.trajectories.length} moved
              </span>
            </div>
            <OverviewMovers movers={movers} orgSlug={d.slug} deltaLabel={d.deltaLabel} voice="log" />
          </div>
        </div>

        <OverviewAltimeterDials readings={readings} slug={d.slug} search={d.search} owed={owed} className="mt-6 border-t border-divider pt-5" />
      </Surface>

      <Surface className="px-6">
        <OverviewDisclosure
          id="heatmap"
          label="Readout · repo × dimension"
          summary={`${d.heatmapRows.length} repos × ${DIMS.length} dimensions`}
          defaultOpen={Boolean(d.sortDim)}
        >
          <RepoDimensionHeatmap org={d.slug} dims={DIMS} rows={d.heatmapRows} initialSortDim={d.sortDim} />
        </OverviewDisclosure>
        <div data-tour="results-view">
          <OverviewDisclosure label="Readout · cohorts" summary={`${d.trajectories.length} repos by type · stack · level`}>
            <RepoCategoryRollup trajectories={d.trajectories} periodTitle={d.periodTitle} orgSlug={d.slug} />
          </OverviewDisclosure>
        </div>
        <OverviewDisclosure label="Readout · full ledger" summary={`${readings.length} dimensions · ${owed} owe a follow-up`}>
          <LedgerDimensionRows slug={d.slug} readings={readings} search={d.search} />
        </OverviewDisclosure>
      </Surface>
    </div>
  );
}
