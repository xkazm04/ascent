"use client";

// The report's active section panel, switched by the sidebar nav (Scoring / Roadmap / Sandbox /
// Contributors). Extracted from ReportView so the orchestrator stays under the 300-LOC ceiling and
// the section switch owns its own cross-fade: the wrapper is keyed on `tab`, so React remounts it on
// every change and replays `animate-fade-in` (a clean fade, disabled under reduced-motion).

import type { PersistedRecommendation, ScanReport } from "@/lib/types";
import type { HistoryPoint } from "@/lib/db/scans";
import { LEVELS } from "@/lib/maturity/model";
import type { TrendPoint } from "@/components/report/TrendChart";
import type { ReportTab } from "@/components/report/ReportView";
import { ScoringTab } from "@/components/report/ScoringTab";
import { DimensionExplorer } from "@/components/report/DimensionExplorer";
import { RoadmapSandbox } from "@/components/report/RoadmapSandbox";
import { ContributorsPanel } from "@/components/report/ContributorsPanel";
import { NextLevelPath, RoadmapSteps, TrustLadder } from "@/components/report/roadmapPieces";
import { RecommendationTracker } from "@/components/report/RecommendationTracker";

export interface ReportPanelsProps {
  tab: ReportTab;
  report: ScanReport;
  isMock: boolean;
  /** Recent contributors / PR signals surfaced a Contributors tab (else it's a dead end). */
  showActivity: boolean;
  recs: PersistedRecommendation[] | null;
  // Scoring-tab derived series (computed once in ReportView from live report + persisted history).
  overallDelta: number | null;
  trendPoints: TrendPoint[];
  histError: boolean;
  scans: HistoryPoint[];
  prevPosture: { adoption: number; rigor: number } | null;
  prevDimScores: Map<string, number> | null;
  dimSeries: Map<string, TrendPoint[]> | null;
}

export function ReportPanels(props: ReportPanelsProps) {
  const { tab, report, isMock, showActivity, recs } = props;
  const curIdx = LEVELS.findIndex((l) => l.id === report.level.id);
  const nextLevel = curIdx >= 0 && curIdx < LEVELS.length - 1 ? LEVELS[curIdx + 1] : null;

  return (
    // Keyed on `tab` → remounts on section change → replays the fade. The min-height keeps the
    // surrounding layout from jumping during the brief fade as the new panel paints in.
    <div key={tab} className="animate-fade-in">
      {tab === "scoring" && (
        <ScoringTab
          report={report}
          isMock={isMock}
          overallDelta={props.overallDelta}
          trendPoints={props.trendPoints}
          histError={props.histError}
          scans={props.scans}
          prevPosture={props.prevPosture}
        />
      )}

      {tab === "dimensions" && (
        <DimensionExplorer report={report} prevDimScores={props.prevDimScores} dimSeries={props.dimSeries} />
      )}

      {tab === "sandbox" && (
        <div data-testid="report-tab-sandbox">
          {/* Roadmap sandbox — drag dimensions, watch the future (client-side what-if recompute) */}
          <RoadmapSandbox report={report} />
        </div>
      )}

      {showActivity && tab === "contributors" && <ContributorsPanel report={report} />}

      {tab === "roadmap" && (
        <div className="space-y-8" data-testid="report-tab-roadmap">
          {/* Trust ladder — where this repo sits, what the next rung needs */}
          <TrustLadder currentId={report.level.id} />

          {/* Gaps to explore — trust-gap exploration, not a directive list */}
          <div>
            <h2 className="text-xl font-bold text-white">
              Gaps to explore
              {nextLevel ? ` — your next rung: ${nextLevel.id} ${nextLevel.name}` : " — sustaining the summit"}
            </h2>
            <p className="mt-1 text-base text-slate-400">
              {recs && recs.length > 0
                ? "Inputs to explore at your own pace — these aren't orders. Track what you take on."
                : "Where trust in AI could grow — open questions to explore, quick wins first."}
            </p>
            <NextLevelPath report={report} />
            <div className="mt-4">
              {recs && recs.length > 0 ? (
                <RecommendationTracker items={recs} report={report} />
              ) : (
                <RoadmapSteps items={report.roadmap} report={report} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
