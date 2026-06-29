"use client";

import Link from "next/link";
import type { ScanReport } from "@/lib/types";
import type { HistoryPoint } from "@/lib/db/scans";
import { LevelBadge } from "@/components/LevelBadge";
import { ScoreRing } from "@/components/report/Charts";
import { TrendChart, type TrendPoint } from "@/components/report/TrendChart";
import { DeltaPill } from "@/components/report/deltas";
import { PosturePanel } from "@/components/report/PosturePanel";
import { ScoreWaterfall } from "@/components/report/ScoreWaterfall";
import { LevelLadder, ListCard } from "@/components/report/ReportCards";
import { Surface } from "@/components/ui";

export function ScoringTab({
  report,
  isMock,
  overallDelta,
  trendPoints,
  histError,
  scans,
  prevPosture,
}: {
  report: ScanReport;
  isMock: boolean;
  overallDelta: number | null;
  trendPoints: TrendPoint[];
  histError: boolean;
  scans: HistoryPoint[];
  prevPosture: { adoption: number; rigor: number } | null;
}) {
  const { repo, level } = report;

  // REPORT #1: ReportView migrated the tab switcher to SideNav (aria-current nav buttons), so the
  // old tabpanel ARIA here was orphaned — `aria-labelledby` pointed at a `report-tab-scoring` tab
  // element that no longer renders. Treat this as a labelled section (matching the sibling panels,
  // which carry no tabpanel role) instead of a broken half of a tabs widget.
  return (
    <section aria-label="Scoring" className="space-y-8" data-testid="report-tab-scoring">
      {/* Score + headline + ladder */}
      <Surface radius="2xl" className="relative grid gap-6 overflow-hidden p-6 lg:grid-cols-[auto_1fr]">
        <div aria-hidden className="strata pointer-events-none absolute inset-0" />
        <div className="relative flex flex-col items-center justify-center">
          <ScoreRing score={report.overallScore} level={level} />
          {overallDelta !== null && <DeltaPill delta={overallDelta} suffix="since last scan" className="mt-3" />}
        </div>
        <div className="relative flex flex-col justify-center">
          <LevelBadge id={level.id} name={level.name} />
          <p className="mt-3 text-lg font-medium text-white">{report.headline}</p>
          {isMock && (
            <p className="mt-1 text-base text-sky-300/80">
              Scores are computed from deterministic signals, not LLM-written analysis.
            </p>
          )}
          <p className="mt-2 text-base leading-relaxed text-slate-400">{level.description}</p>
          <LevelLadder currentId={level.id} />
        </div>
      </Surface>

      {/* Glass-box score waterfall — the headline, attributed to each dimension */}
      <ScoreWaterfall report={report} />

      {/* Posture — Adoption × Rigor */}
      <PosturePanel report={report} prev={prevPosture} />

      {/* Trend over time */}
      {trendPoints.length >= 1 && (
        <Surface radius="2xl" className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-white">Maturity over time</h2>
              <p className="text-base text-slate-400">
                {histError
                  ? "Couldn't load history — showing this scan only."
                  : trendPoints.length === 1
                    ? "Baseline established — re-scan later to track progress."
                    : `${trendPoints.length} scans tracked.`}
              </p>
            </div>
            {overallDelta !== null && <DeltaPill delta={overallDelta} className="mt-3" />}
          </div>
          <div className="mt-4">
            <TrendChart points={trendPoints} />
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-x-5 gap-y-1 text-right">
            {scans.length >= 2 && (
              <Link
                href={`/report/compare?repo=${encodeURIComponent(`${repo.owner}/${repo.name}`)}`}
                className="font-mono text-sm uppercase tracking-widest text-accent hover:text-accent-soft"
              >
                What changed →
              </Link>
            )}
            <Link
              href={`/trends?repo=${encodeURIComponent(`${repo.owner}/${repo.name}`)}`}
              className="font-mono text-sm uppercase tracking-widest text-accent hover:text-accent-soft"
            >
              Dimension-level trends →
            </Link>
          </div>
        </Surface>
      )}

      {/* Strengths / Risks */}
      {(report.strengths.length > 0 || report.risks.length > 0) && (
        <div className="grid gap-5 md:grid-cols-2">
          <ListCard title="Strengths" items={report.strengths} tone="good" />
          <ListCard title="Risks & gaps" items={report.risks} tone="bad" />
        </div>
      )}

      {/* The radar + per-dimension breakdown moved to its own Dimensions section (DimensionExplorer) —
          a click-to-explore chart + bars + detail — so Scoring stays focused on the headline score story. */}
    </section>
  );
}
