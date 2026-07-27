"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { AppPassport, PersistedRecommendation, ScanReport } from "@/lib/types";
import type { RepositoryHistory } from "@/lib/db/scans";
import { parseRepositoryHistory } from "@/lib/report/validate";
import { classifyHistoryResponse } from "@/components/report/reportTaxonomy";
import { computeReportSeries } from "@/components/report/reportSeries";
import { ReportHeader } from "@/components/report/ReportHeader";
import { PassportHero } from "@/components/report/PassportHero";
import { ReportPanels } from "@/components/report/ReportPanels";
import { ReportConversionCta } from "@/components/report/ReportConversionCta";
import { ReportWarnings, ReportDiscrepancies } from "@/components/report/ReportNotices";
import { SideNav, type SideNavGroup } from "@/components/ui";

// Report body section ids. (Previously lived in the now-deleted ReportTabBar, whose only
// surviving consumer was this type import — the tab switcher itself migrated to SideNav.)
export type ReportTab = "scoring" | "dimensions" | "roadmap" | "sandbox" | "contributors";

export function ReportView({
  report,
  onRetest,
  rescanning,
  serverPassport,
  serverHistory,
  serverRecs,
}: {
  report: ScanReport;
  onRetest?: () => void;
  /** An in-place re-test is running — the report stays mounted while ReportClient shows a re-scan
   *  banner; forwarded to the header so the Re-test control reflects the in-flight state. */
  rescanning?: boolean;
  /** SERVER-PROVIDED DATA (permalink path only). The /report/{owner}/{repo} route already holds a DB
   *  session and reads the report there, so it composes the same readers /api/report/passport,
   *  /api/history and /api/recommendations use and threads the results down. When a prop is present
   *  the matching client fetch is SKIPPED — the passport hero (and the trend/roadmap data) is then in
   *  the SSR HTML and paints with the report instead of popping in a beat later. The live-scan path
   *  (/report?repo= → ReportClient) passes none of these, so its fetch-after-hydration flow is
   *  unchanged, and each prop is independently optional (a server read that was gated or failed
   *  simply stays undefined and falls back to its fetch). */
  serverPassport?: AppPassport | null;
  serverHistory?: RepositoryHistory | null;
  serverRecs?: PersistedRecommendation[] | null;
}) {
  const { repo } = report;
  const repoFull = `${repo.owner}/${repo.name}`;
  // Keyless deterministic demo (no LLM). Drive every engine-related treatment off this single
  // flag so the demo signal stays consistent everywhere the engine is shown.
  const isMock = report.engine.provider === "mock";

  const [history, setHistory] = useState<RepositoryHistory | null>(serverHistory ?? null);
  const [recs, setRecs] = useState<PersistedRecommendation[] | null>(serverRecs ?? null);
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
    if (serverPassport !== undefined) return; // permalink: the server already resolved it (or proved there is none)
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
  }, [repoFull, report.passport, serverPassport]);

  // Live report's own passport wins; then the server-rendered one (permalink — present in first paint);
  // otherwise the fetched one, but only while it still matches this repo.
  const passport: AppPassport | null =
    report.passport ?? serverPassport ?? (fetchedPassport?.repo === repoFull ? fetchedPassport.passport : null);

  // The server props describe the scan that was server-rendered. An in-place re-test replaces the
  // report under us (scannedAt moves), at which point they're stale and the fetches must run again —
  // so pin the rendered scan and only honor the props while the report still matches it.
  // (Pinned with useState, not useRef: reading a ref during render is a React-Compiler violation.)
  const [serverScannedAt] = useState(report.scannedAt);
  const serverDataCurrent = serverScannedAt === report.scannedAt;

  useEffect(() => {
    const repoRef = `${repo.owner}/${repo.name}`;
    let active = true;
    // History and recommendations are two independent sources fetched in parallel but settled
    // SEPARATELY — a recommendations failure must NOT pollute the history disposition. Previously
    // both shared one Promise.all + try/catch + the `histError` flag, so a malformed/non-JSON recs
    // payload (or a recs-only network fail) flipped the Trend panel to "Couldn't load history" even
    // though history loaded fine, while the genuine recs failure was swallowed with no signal.
    (async () => {
      // Permalink: the server already read this repo's history under the same org scope and gate —
      // it's in `history` from the initial state, so there is nothing to fetch.
      if (serverHistory !== undefined && serverHistory !== null && serverDataCurrent) return;
      try {
        const h = await fetch(`/api/history?repo=${encodeURIComponent(repoRef)}`);
        // A non-OK history response is a FAILURE, not "no history yet" — without this branch an
        // HTTP 500 (e.g. a transient DB token expiry) silently rendered "Baseline established"
        // over months of real history. 503 (persistence off) and 401 (signed-out viewer) are
        // legitimate no-trends modes and keep the quiet baseline path. (classifyHistoryResponse)
        if (active) {
          const disposition = classifyHistoryResponse(h.status, h.ok);
          if (disposition === "ok") setHistory(parseRepositoryHistory(await h.json()));
          else if (disposition === "error") setHistError(true);
        }
      } catch {
        // Couldn't reach the history endpoint (offline / transient). Surface it in the trend panel
        // instead of silently degrading to a misleading "Baseline established".
        if (active) setHistError(true);
      }
    })();
    (async () => {
      // Permalink: server-provided (see `serverRecs`). `[]` is a real answer — "no persisted
      // recommendations", which renders the read-only roadmap fallback — so only `null`/absent refetches.
      if (serverRecs !== undefined && serverRecs !== null && serverDataCurrent) return;
      try {
        const r = await fetch(`/api/recommendations?repo=${encodeURIComponent(repoRef)}`);
        if (active && r.ok) setRecs(((await r.json()).items ?? []) as PersistedRecommendation[]);
      } catch {
        // A recommendations failure leaves the read-only roadmap fallback (recs stays null); it is
        // deliberately NOT folded into histError, which is solely about the history/trend panel.
      }
    })();
    return () => {
      active = false;
    };
    // report.scannedAt changes after an in-place re-test (owner/name don't), so include it to
    // re-fetch history + recommendations for the fresh scan — otherwise the Roadmap tab keeps
    // rendering the previous scan's recommendations and stale compare/"what changed" affordances.
  }, [repo.owner, repo.name, report.scannedAt, serverHistory, serverRecs, serverDataCurrent]);

  // Reconcile the live report with persisted history (delta baseline, trend series, per-dimension
  // sparkline series, prior posture). All pure history×report shaping — extracted to computeReportSeries.
  // Memoize on [history, report] so switching the section tab — which re-renders via
  // `tab`/`recs`/`fetchedPassport` state — doesn't recompute the whole series set.
  const { scans, trendPoints, overallDelta, prevDimScores, prevPosture, dimSeries } = useMemo(
    () => computeReportSeries(history, report),
    [history, report],
  );

  // Recent contributors + PR signals only earn a tab when the scan actually surfaced that data —
  // an empty "Contributors" tab would be a dead end. Scoring/Roadmap/Sandbox always have content.
  const hasContributors = report.contributors.filter((c) => c.login !== "unknown").length > 0;
  const hasPrStats = !!(report.prStats && report.prStats.analyzed > 0);
  const showActivity = hasContributors || hasPrStats;

  // The active section is URL-backed (?tab=…) so a report tab is shareable, bookmarkable, and survives
  // Back/forward + refresh — a report is an artifact people link to, and the org dashboard already keeps
  // its scope in the URL. `scoring` is the default and stays clean (no param). An unknown or unavailable
  // tab (e.g. ?tab=contributors on a scan with no activity) falls back to scoring.
  const params = useSearchParams();
  const pathname = usePathname();
  const validTabs: ReportTab[] = ["scoring", "dimensions", "roadmap", "sandbox", ...(showActivity ? (["contributors"] as const) : [])];
  const tabParam = params.get("tab") as ReportTab | null;
  const tab: ReportTab = tabParam && validTabs.includes(tabParam) ? tabParam : "scoring";
  const setTab = (t: ReportTab) => {
    const next = new URLSearchParams(params.toString());
    if (t === "scoring") next.delete("tab");
    else next.set("tab", t);
    const qs = next.toString();
    // Use the native History API rather than router.replace(): the /report page is `force-dynamic`, so
    // a router navigation on every section click refetched the entire server tree (ReportShell's
    // SiteHeader/SiteFooter auth reads) even though the panels are 100% client-rendered off this `tab`.
    // history.replaceState updates the shareable URL with ZERO server work and still syncs useSearchParams
    // in Next's App Router (so `tab` above recomputes on the next render). (report-report-shell-tabs #4)
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  };
  const tabs: { id: ReportTab; label: string }[] = [
    { id: "scoring", label: "Scoring" },
    { id: "dimensions", label: "Dimensions" },
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
      <ReportWarnings warnings={report.warnings} />

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

      <ReportDiscrepancies discrepancies={report.discrepancies} />

      {/* Activation nudge: the report is the peak-engagement moment — pull a first-timer toward the
          org rollup + an account (or a signed-in viewer toward the fleet view) instead of dead-ending. */}
      <ReportConversionCta repo={repoFull} />

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
