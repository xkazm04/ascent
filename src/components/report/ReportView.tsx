"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DimensionId, PersistedRecommendation, ScanReport } from "@/lib/types";
import type { RepositoryHistory } from "@/lib/db/scans";
import { parseRepositoryHistory } from "@/lib/report/validate";
import { classifyHistoryResponse } from "@/components/report/reportTaxonomy";
import { LEVELS, axisScore } from "@/lib/maturity/model";
import { type TrendPoint } from "@/components/report/TrendChart";
import { RoadmapSandbox } from "@/components/report/RoadmapSandbox";
import { ReportHeader } from "@/components/report/ReportHeader";
import { ScoringTab } from "@/components/report/ScoringTab";
import { NextLevelPath, RoadmapSteps, TrustLadder } from "@/components/report/roadmapPieces";
import { RecommendationTracker } from "@/components/report/RecommendationTracker";
import { ContributorsPanel } from "@/components/report/ContributorsPanel";
import { SideNav, type SideNavGroup } from "@/components/ui";

// Report body section ids. (Previously lived in the now-deleted ReportTabBar, whose only
// surviving consumer was this type import — the tab switcher itself migrated to SideNav.)
export type ReportTab = "scoring" | "roadmap" | "sandbox" | "contributors";

export function ReportView({
  report,
  onRetest,
  rescanning,
}: {
  report: ScanReport;
  onRetest?: () => void;
  /** An in-place re-test is running — the report stays mounted while ReportClient shows a re-scan
   *  banner; forwarded to the header so the Re-test control reflects the in-flight state. */
  rescanning?: boolean;
}) {
  const { repo, level } = report;
  // Keyless deterministic demo (no LLM). Drive every engine-related treatment off this single
  // flag so the demo signal stays consistent everywhere the engine is shown.
  const isMock = report.engine.provider === "mock";
  const curIdx = LEVELS.findIndex((l) => l.id === level.id);
  const nextLevel = curIdx >= 0 && curIdx < LEVELS.length - 1 ? LEVELS[curIdx + 1] : null;

  const [history, setHistory] = useState<RepositoryHistory | null>(null);
  const [recs, setRecs] = useState<PersistedRecommendation[] | null>(null);
  // Distinguishes a genuine history-fetch failure (offline / transient) from the legitimate
  // "no history yet" baseline — otherwise both render an identical "Baseline established" panel.
  const [histError, setHistError] = useState(false);

  useEffect(() => {
    const repoRef = `${repo.owner}/${repo.name}`;
    let active = true;
    (async () => {
      try {
        const [h, r] = await Promise.all([
          fetch(`/api/history?repo=${encodeURIComponent(repoRef)}`),
          fetch(`/api/recommendations?repo=${encodeURIComponent(repoRef)}`),
        ]);
        // A non-OK history response is a FAILURE, not "no history yet" — without this branch an
        // HTTP 500 (e.g. a transient DB token expiry) silently rendered "Baseline established"
        // over months of real history. 503 (persistence off) and 401 (signed-out viewer) are
        // legitimate no-trends modes and keep the quiet baseline path. (classifyHistoryResponse)
        if (active) {
          const disposition = classifyHistoryResponse(h.status, h.ok);
          if (disposition === "ok") setHistory(parseRepositoryHistory(await h.json()));
          else if (disposition === "error") setHistError(true);
        }
        if (active && r.ok) setRecs(((await r.json()).items ?? []) as PersistedRecommendation[]);
      } catch {
        // Couldn't reach the history endpoint (offline / transient). Surface it in the trend panel
        // instead of silently degrading to a misleading "Baseline established".
        if (active) setHistError(true);
      }
    })();
    return () => {
      active = false;
    };
    // report.scannedAt changes after an in-place re-test (owner/name don't), so include it to
    // re-fetch history + recommendations for the fresh scan — otherwise the Roadmap tab keeps
    // rendering the previous scan's recommendations and stale compare/"what changed" affordances.
  }, [repo.owner, repo.name, report.scannedAt]);

  // Reconcile the live report with persisted history. `history.scans` is newest-first and
  // MAY already include the scan being viewed (it can be persisted mid-stream) — or may not,
  // if the history fetch raced the write. Identify whether the current scan is stored (by
  // timestamp), and pick the baseline for deltas as the most recent scan STRICTLY older than
  // this report. This keeps the headline ring's "since last scan" delta and the trend line's
  // last point in agreement: no double-counting when the current scan IS stored, and no
  // skipping the true previous when it ISN'T.
  const scans = history?.scans ?? [];
  // Reconcile by parsed INSTANT, not byte-identical ISO strings. The stored scannedAt
  // (Date.toISOString) and the live report.scannedAt are serialized independently and can differ by a
  // character (ms precision, "+00:00" vs "Z") for the same instant — an exact-string compare would
  // then mis-detect the current scan as absent and append a phantom duplicate trend point, and a
  // lexicographic "<" diverges from chronological order under mixed ISO offsets. Match within a 1s
  // tolerance; fall back to raw-string compare only when a timestamp isn't Date-parseable.
  const reportAt = Date.parse(report.scannedAt);
  const sameInstant = (a: string) => {
    const ta = Date.parse(a);
    return Number.isNaN(ta) || Number.isNaN(reportAt) ? a === report.scannedAt : Math.abs(ta - reportAt) < 1000;
  };
  const currentStored = scans.some((s) => sameInstant(s.scannedAt));
  // Baseline = most recent scan STRICTLY older than this report (and not the current scan itself,
  // which can be stored at a near-identical instant), compared as instants rather than lexically.
  const baselineScan =
    scans.find((s) => {
      const ts = Date.parse(s.scannedAt);
      if (Number.isNaN(ts) || Number.isNaN(reportAt)) return s.scannedAt < report.scannedAt;
      return ts < reportAt && !sameInstant(s.scannedAt);
    }) ?? null;

  // Overall-score series (oldest → newest). Append the current point when it isn't persisted
  // yet, so the last trend dot always matches the ScoreRing rather than omitting it.
  const trendPoints: TrendPoint[] = (() => {
    const chrono: TrendPoint[] = [...scans]
      .reverse()
      .map((s) => ({ score: s.overallScore, at: s.scannedAt, engine: s.engineProvider }));
    if (!currentStored)
      chrono.push({ score: report.overallScore, at: report.scannedAt, engine: report.engine.provider });
    return chrono;
  })();

  const overallDelta = baselineScan ? report.overallScore - baselineScan.overallScore : null;
  const prevDimScores = baselineScan ? new Map(baselineScan.dimensions.map((d) => [d.dimId, d.score])) : null;

  // Baseline scan's posture position, for the quadrant trail. Persisted history doesn't store
  // the archetype, so re-roll the axes under the current lens (a faithful-enough trail).
  const prevPosture = baselineScan
    ? (() => {
        const m = new Map(baselineScan.dimensions.map((d) => [d.dimId as DimensionId, d.score]));
        const scoreFor = (id: DimensionId) => m.get(id) ?? 0;
        return {
          adoption: axisScore("adoption", scoreFor, report.archetype),
          rigor: axisScore("rigor", scoreFor, report.archetype),
        };
      })()
    : null;

  // Per-dimension score series (chronological) for sparklines. Append the current report as
  // the last point when it isn't persisted yet, and push ONLY scores that are present in
  // each scan (a dimension absent from an older scan yields a shorter series — a gap — never
  // a fabricated 0).
  const dimSeries = (() => {
    const chrono: { at: string; engine: string; dimensions: { dimId: string; score: number }[] }[] = [
      ...scans,
    ]
      .reverse()
      .map((s) => ({ at: s.scannedAt, engine: s.engineProvider, dimensions: s.dimensions }));
    if (!currentStored) {
      chrono.push({
        at: report.scannedAt,
        engine: report.engine.provider,
        dimensions: report.dimensions.map((d) => ({ dimId: d.id, score: d.score })),
      });
    }
    if (chrono.length < 2) return null;
    const m = new Map<string, TrendPoint[]>();
    for (const s of chrono) {
      for (const d of s.dimensions) {
        const arr = m.get(d.dimId) ?? [];
        arr.push({ score: d.score, at: s.at, engine: s.engine });
        m.set(d.dimId, arr);
      }
    }
    return m;
  })();

  const [tab, setTab] = useState<ReportTab>("scoring");
  // Recent contributors + PR signals only earn a tab when the scan actually surfaced that data —
  // an empty "Contributors" tab would be a dead end. Scoring/Roadmap/Sandbox always have content.
  const hasContributors = report.contributors.filter((c) => c.login !== "unknown").length > 0;
  const hasPrStats = !!(report.prStats && report.prStats.analyzed > 0);
  const showActivity = hasContributors || hasPrStats;
  const tabs: { id: ReportTab; label: string }[] = [
    { id: "scoring", label: "Scoring" },
    { id: "roadmap", label: "Roadmap" },
    { id: "sandbox", label: "Sandbox" },
  ];
  if (showActivity) tabs.push({ id: "contributors", label: "Contributors" });
  // After an in-place re-test the new report may drop a tab the user was on (e.g. the fresh scan
  // surfaces no activity, removing "Contributors"). The selection would then point at a tab that
  // no longer renders, leaving a blank panel with nothing active. Clamp back to Scoring whenever
  // the active tab isn't in the current set.
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab("scoring");
    // showActivity fully determines which tabs exist; re-check when it or the selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, showActivity]);
  const navGroups: SideNavGroup[] = [
    { items: tabs.map((t) => ({ label: t.label, active: tab === t.id, onSelect: () => setTab(t.id) })) },
  ];

  return (
    <div className="animate-fade-up space-y-8" data-testid="report">
      {/* Header */}
      <ReportHeader report={report} isMock={isMock} onRetest={onRetest} rescanning={rescanning} />

      {/* Reliability caveats */}
      {report.warnings && report.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="font-mono text-sm uppercase tracking-widest text-amber-400">Heads up</div>
          <ul className="mt-2 space-y-1 text-base text-amber-200/90">
            {report.warnings.map((w, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden>⚠</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Left-rail section nav + the active panel. Header / caveats / flagged-for-review stay
          full-width outside the rail as always-visible context. */}
      <div className="lg:grid lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-8">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <SideNav groups={navGroups} ariaLabel="Report sections" />
        </aside>
        <div className="mt-4 space-y-8 lg:mt-0">
      {tab === "scoring" && (
        <ScoringTab
          report={report}
          isMock={isMock}
          overallDelta={overallDelta}
          trendPoints={trendPoints}
          histError={histError}
          scans={scans}
          prevPosture={prevPosture}
          prevDimScores={prevDimScores}
          dimSeries={dimSeries}
        />
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
          Gaps to explore{nextLevel ? ` — your next rung: ${nextLevel.id} ${nextLevel.name}` : " — sustaining the summit"}
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
      </div>

      {report.discrepancies.length > 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] p-5">
          <h2 className="text-lg font-semibold text-white">Flagged for review</h2>
          <p className="mt-1 text-base text-slate-400">
            The AI auditor believes these deterministic signals may be wrong — worth verifying,
            and a useful signal for improving the detectors.
          </p>
          <ul className="mt-3 space-y-2 text-base">
            {report.discrepancies.map((d, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-mono text-sm text-amber-400">{d.dimension}</span>
                <span className="text-slate-300">{d.claim}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-center pt-2">
        <Link
          href="/"
          className="rounded-xl border border-slate-700 px-5 py-2.5 text-base text-slate-300 transition hover:border-accent hover:text-white"
        >
          ← Scan another repo
        </Link>
      </div>
    </div>
  );
}
