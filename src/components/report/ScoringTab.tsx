"use client";

import Link from "next/link";
import type { ScanReport } from "@/lib/types";
import type { HistoryPoint } from "@/lib/db/scans";
import { LevelBadge } from "@/components/LevelBadge";
import { RadarChart, ScoreRing } from "@/components/report/Charts";
import { TrendChart, type TrendPoint } from "@/components/report/TrendChart";
import { DeltaPill } from "@/components/report/deltas";
import { PosturePanel } from "@/components/report/PosturePanel";
import { ScoreWaterfall } from "@/components/report/ScoreWaterfall";
import { LevelLadder, ListCard } from "@/components/report/ReportCards";
import { DimensionCard } from "@/components/report/DimensionCard";

export function ScoringTab({
  report,
  isMock,
  overallDelta,
  trendPoints,
  histError,
  scans,
  prevPosture,
  prevDimScores,
  dimSeries,
}: {
  report: ScanReport;
  isMock: boolean;
  overallDelta: number | null;
  trendPoints: TrendPoint[];
  histError: boolean;
  scans: HistoryPoint[];
  prevPosture: { adoption: number; rigor: number } | null;
  prevDimScores: Map<string, number> | null;
  dimSeries: Map<string, TrendPoint[]> | null;
}) {
  const { repo, level } = report;

  return (
    <div role="tabpanel" id="report-panel-scoring" aria-labelledby="report-tab-scoring" tabIndex={0} className="space-y-8 focus:outline-none" data-testid="report-tab-scoring">
      {/* Score + headline + ladder */}
      <div className="relative grid gap-6 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 p-6 lg:grid-cols-[auto_1fr]">
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
      </div>

      {/* Glass-box score waterfall — the headline, attributed to each dimension */}
      <ScoreWaterfall report={report} />

      {/* Posture — Adoption × Rigor */}
      <PosturePanel report={report} prev={prevPosture} />

      {/* Trend over time */}
      {trendPoints.length >= 1 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
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
        </div>
      )}

      {/* Strengths / Risks */}
      {(report.strengths.length > 0 || report.risks.length > 0) && (
        <div className="grid gap-5 md:grid-cols-2">
          <ListCard title="Strengths" items={report.strengths} tone="good" />
          <ListCard title="Risks & gaps" items={report.risks} tone="bad" />
        </div>
      )}

      {/* Radar + dimension breakdown */}
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="flex items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <RadarChart dimensions={report.dimensions} />
        </div>
        <div className="space-y-3">
          {report.dimensions.map((d, i) => (
            <DimensionCard key={d.id} d={d} index={i} prevScore={prevDimScores?.get(d.id)} series={dimSeries?.get(d.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}
