"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { AppPassport, DimensionId, PersistedRecommendation, ScanReport } from "@/lib/types";
import type { RepositoryHistory } from "@/lib/db/scans";
import { parseRepositoryHistory } from "@/lib/report/validate";
import { classifyHistoryResponse } from "@/components/report/reportTaxonomy";
import { axisScore } from "@/lib/maturity/model";
import { type TrendPoint } from "@/components/report/TrendChart";
import { ReportHeader } from "@/components/report/ReportHeader";
import { PassportHero } from "@/components/report/PassportHero";
import { ReportPanels } from "@/components/report/ReportPanels";
import { ReportConversionCta } from "@/components/report/ReportConversionCta";
import { SideNav, type SideNavGroup } from "@/components/ui";

// Report body section ids. (Previously lived in the now-deleted ReportTabBar, whose only
// surviving consumer was this type import — the tab switcher itself migrated to SideNav.)
export type ReportTab = "scoring" | "dimensions" | "roadmap" | "sandbox" | "contributors";

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
  const { repo } = report;
  const repoFull = `${repo.owner}/${repo.name}`;
  // Keyless deterministic demo (no LLM). Drive every engine-related treatment off this single
  // flag so the demo signal stays consistent everywhere the engine is shown.
  const isMock = report.engine.provider === "mock";

  const [history, setHistory] = useState<RepositoryHistory | null>(null);
  const [recs, setRecs] = useState<PersistedRecommendation[] | null>(null);
  // Distinguishes a genuine history-fetch failure (offline / transient) from the legitimate
  // "no history yet" baseline — otherwise both render an identical "Baseline established" panel.
  const [histError, setHistError] = useState(false);
  // The App Readiness Passport drives the hero. A LIVE scan carries it on the report (built during the
  // scan); a report rebuilt from the DB (cache hit / permalink) doesn't, so fall back to the stored
  // passport endpoint. The fetched passport is TAGGED with its repo so it's ignored once the repo
  // changes (no stale carry-over) — letting us DERIVE the displayed passport instead of syncing state.
  const [fetchedPassport, setFetchedPassport] = useState<{ repo: string; passport: AppPassport } | null>(null);

  useEffect(() => {
    if (report.passport) return; // already in hand from the live scan — no fetch needed
    let active = true;
    (async () => {
      try {
        const r = await fetch(`/api/report/passport?repo=${encodeURIComponent(repoFull)}`);
        if (active && r.ok) setFetchedPassport({ repo: repoFull, passport: (await r.json()) as AppPassport });
      } catch {
        // No stored passport (offline / no DB / not yet persisted) — the hero just doesn't render.
      }
    })();
    return () => {
      active = false;
    };
  }, [repoFull, report.passport]);

  // Live report's own passport wins; otherwise the fetched one, but only while it still matches this repo.
  const passport: AppPassport | null =
    report.passport ?? (fetchedPassport?.repo === repoFull ? fetchedPassport.passport : null);

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
  }, [repo.owner, repo.name]);

  // Reconcile the live report with persisted history. `history.scans` is newest-first and
  // MAY already include the scan being viewed (it can be persisted mid-stream) — or may not,
  // if the history fetch raced the write. Identify whether the current scan is stored (by
  // timestamp), and pick the baseline for deltas as the most recent scan STRICTLY older than
  // this report. This keeps the headline ring's "since last scan" delta and the trend line's
  // last point in agreement: no double-counting when the current scan IS stored, and no
  // skipping the true previous when it ISN'T.
  // All of the below is pure history×report shaping (including dimSeries, which rebuilds a Map over up
  // to `limit` scans × |dimensions|). Memoize on [history, report] so switching the section tab — which
  // re-renders via `tab`/`recs`/`fetchedPassport` state — doesn't recompute the whole series set.
  const { scans, trendPoints, overallDelta, prevDimScores, prevPosture, dimSeries } = useMemo(() => {
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

    return { scans, trendPoints, overallDelta, prevDimScores, prevPosture, dimSeries };
  }, [history, report]);

  // Recent contributors + PR signals only earn a tab when the scan actually surfaced that data —
  // an empty "Contributors" tab would be a dead end. Scoring/Roadmap/Sandbox always have content.
  const hasContributors = report.contributors.filter((c) => c.login !== "unknown").length > 0;
  const hasPrStats = !!(report.prStats && report.prStats.analyzed > 0);
  const showActivity = hasContributors || hasPrStats;

  // The active section is URL-backed (?tab=…) so a report tab is shareable, bookmarkable, and survives
  // Back/forward + refresh — a report is an artifact people link to, and the org dashboard already keeps
  // its scope in the URL. `scoring` is the default and stays clean (no param). An unknown or unavailable
  // tab (e.g. ?tab=contributors on a scan with no activity) falls back to scoring. `router.replace` with
  // scroll:false swaps the tab without a history-stack entry per click or a scroll jump.
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const validTabs: ReportTab[] = ["scoring", "dimensions", "roadmap", "sandbox", ...(showActivity ? (["contributors"] as const) : [])];
  const tabParam = params.get("tab") as ReportTab | null;
  const tab: ReportTab = tabParam && validTabs.includes(tabParam) ? tabParam : "scoring";
  const setTab = (t: ReportTab) => {
    const next = new URLSearchParams(params.toString());
    if (t === "scoring") next.delete("tab");
    else next.set("tab", t);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const tabs: { id: ReportTab; label: string }[] = [
    { id: "scoring", label: "Scoring" },
    { id: "dimensions", label: "Dimensions" },
    { id: "roadmap", label: "Roadmap" },
    { id: "sandbox", label: "Sandbox" },
  ];
  if (showActivity) tabs.push({ id: "contributors", label: "Contributors" });
  const navGroups: SideNavGroup[] = [
    { label: "Sections", items: tabs.map((t) => ({ label: t.label, active: tab === t.id, onSelect: () => setTab(t.id) })) },
  ];

  return (
    <div className="animate-fade-up space-y-8" data-testid="report">
      {/* Header */}
      <ReportHeader report={report} isMock={isMock} onRetest={onRetest} rescanning={rescanning} />

      {/* App Readiness Passport — the first thing seen: the two-axis trust scorecard for this codebase,
          full-width above the section nav so it leads every tab. Omitted when no passport is available. */}
      {passport && <PassportHero passport={passport} repo={`${repo.owner}/${repo.name}`} />}

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

      {/* Section nav as a distinct left sidebar. On wide desktops (2xl+, where the centered max-w-6xl
          body leaves room in the left gutter) the rail floats OUTSIDE the content into that gutter —
          sticky, absolutely positioned to the left of the body — so the panels reclaim the full width.
          Below 2xl it stays an in-flow left column (lg) / horizontal scroller (mobile). The active panel
          owns its own cross-fade (see ReportPanels). */}
      <div className="relative lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10 2xl:block">
        <aside className="lg:sticky lg:top-24 lg:self-start lg:border-r lg:border-divider lg:pr-6 2xl:absolute 2xl:inset-y-0 2xl:right-full 2xl:mr-6 2xl:w-40 2xl:self-auto 2xl:border-0 2xl:pr-0">
          <div className="2xl:sticky 2xl:top-24">
            <SideNav groups={navGroups} ariaLabel="Report sections" />
          </div>
        </aside>
        <div className="mt-6 lg:mt-0">
          <ReportPanels
            tab={tab}
            report={report}
            isMock={isMock}
            showActivity={showActivity}
            recs={recs}
            overallDelta={overallDelta}
            trendPoints={trendPoints}
            histError={histError}
            scans={scans}
            prevPosture={prevPosture}
            prevDimScores={prevDimScores}
            dimSeries={dimSeries}
          />
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

      {/* Activation nudge: the report is the peak-engagement moment — pull a first-timer toward the
          org rollup + an account (or a signed-in viewer toward the fleet view) instead of dead-ending. */}
      <ReportConversionCta />

      <div className="flex justify-center pt-2">
        <Link
          href="/?scan=1"
          className="rounded-xl border border-slate-700 px-5 py-2.5 text-base text-slate-300 transition hover:border-accent hover:text-white"
        >
          ← Scan another repo
        </Link>
      </div>
    </div>
  );
}
