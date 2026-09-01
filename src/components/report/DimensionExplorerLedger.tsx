"use client";

// Variant: LEDGER — the index page. No chart at all: one hairline-ruled ledger where each dimension is
// a typeset line carrying every fact the reader needs to compare (weight, what the detectors and the
// model each said, how many overall points are still in reach, the since-last delta, the score) and
// a sort that reorders the ledger by rubric order, by score, or by lever. Expanding a line drops the
// evidence in place, so the eye never leaves the column of figures. A stat ledger closes the page
// with the four numbers that summarize the nine.

import { useState } from "react";
import type { DimensionId, ScanReport } from "@/lib/types";
import { scoreHex } from "@/lib/ui";
import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import type { TrendPoint } from "@/components/report/TrendChart";
import { DimensionDetail } from "@/components/report/DimensionDetail";
import { DimensionLedgerRow, LEDGER_COLS } from "@/components/report/DimensionLedgerRow";
import { dimFacts, explorerSummary, type DimFacts } from "@/components/report/dimensionExplorerDerive";
import { EmptyState } from "@/components/EmptyState";
import { Dateline, HairlineGrid, Kicker, Stat, chipButtonClass } from "@/components/ui";

type SortKey = "rubric" | "score" | "lever";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "rubric", label: "Rubric order" },
  { key: "score", label: "By score" },
  { key: "lever", label: "By lever" },
];

function sorted(facts: DimFacts[], key: SortKey): DimFacts[] {
  if (key === "score") return [...facts].sort((a, b) => b.d.score - a.d.score);
  if (key === "lever") return [...facts].sort((a, b) => b.headroom - a.headroom);
  return facts;
}

export function DimensionExplorerLedger({
  report,
  prevDimScores,
  dimSeries,
}: {
  report: ScanReport;
  prevDimScores: Map<string, number> | null;
  dimSeries: Map<string, TrendPoint[]> | null;
}) {
  const facts = report.dimensions.map((d) => dimFacts(d, prevDimScores?.get(d.id), report.scoreIntegrity));
  const [expandedId, setExpandedId] = useState<DimensionId | null>(facts[0]?.id ?? null);
  const [sort, setSort] = useState<SortKey>("rubric");
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const summary = explorerSummary(facts);

  if (!summary) {
    return (
      <section aria-label="Dimensions" data-testid="report-tab-dimensions">
        <EmptyState variant="section" title="No dimensions were scored" body="Nothing could be measured on this scan." />
      </section>
    );
  }

  const rows = sorted(facts, sort);
  const maxHeadroom = Math.max(...facts.map((f) => f.headroom));
  const totalHeadroom = facts.reduce((s, f) => s + f.headroom, 0);
  const hasPrev = facts.some((f) => f.delta !== null);

  return (
    <section aria-label="Dimensions" data-testid="report-tab-dimensions" className="space-y-6">
      <Dateline
        left={`Dimension index · ${facts.length} dimensions · weighted 0–100`}
        right={hasPrev ? "Δ vs previous scan" : "First scan · no prior reading"}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="type-title font-bold text-white">Dimension breakdown</h2>
          <p className="mt-1 max-w-2xl type-body text-slate-400">{summary.line}.</p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Sort dimensions">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={sort === s.key}
              onClick={() => setSort(s.key)}
              className={chipButtonClass("idle", sort === s.key ? "border-accent text-white" : "")}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <HairlineGrid className="grid-cols-1">
        <div className={`grid gap-x-3 bg-ink px-4 py-2 ${LEDGER_COLS}`} aria-hidden>
          <Kicker tone="muted">#</Kicker>
          <Kicker tone="muted">Dimension</Kicker>
          <Kicker tone="muted">Wt</Kicker>
          <Kicker tone="muted" className="hidden md:block">Det.</Kicker>
          <Kicker tone="muted" className="hidden md:block">Model</Kicker>
          <Kicker tone="muted" className="hidden md:block">In reach</Kicker>
          <Kicker tone="muted" className="hidden md:block">Trend</Kicker>
          <Kicker tone="muted" className="hidden md:block">Δ</Kicker>
          <Kicker tone="muted" className="text-right">Score</Kicker>
        </div>
        {rows.map((f, i) => (
          <DimensionLedgerRow
            key={f.id}
            f={f}
            index={i}
            expanded={expandedId === f.id}
            onToggle={() => setExpandedId(expandedId === f.id ? null : f.id)}
            series={dimSeries?.get(f.id)}
            maxHeadroom={maxHeadroom}
            mounted={mounted}
            reduced={reduced}
          >
            <DimensionDetail d={f.d} prevScore={prevDimScores?.get(f.id)} series={dimSeries?.get(f.id)} integrity={report.scoreIntegrity} />
          </DimensionLedgerRow>
        ))}
      </HairlineGrid>

      <HairlineGrid className="grid-cols-2 md:grid-cols-4">
        <Stat className="bg-ink p-4" label="Overall" value={report.overallScore} color={scoreHex(report.overallScore)} sub={`${report.level.id} ${report.level.name}`} />
        <Stat className="bg-ink p-4" label="In reach" value={`+${totalHeadroom.toFixed(1)}`} sub="overall pts if every dimension hit 100" />
        <Stat className="bg-ink p-4" label="Biggest lever" value={summary.lever.short} sub={`+${summary.lever.headroom.toFixed(1)} pts · now ${summary.lever.d.score}`} />
        <Stat className="bg-ink p-4" label="At Integrated+" value={`${summary.atL4}/${facts.length}`} sub="dimensions at L4 or above" />
      </HairlineGrid>
    </section>
  );
}
