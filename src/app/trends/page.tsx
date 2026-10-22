import Link from "next/link";
import { ReportShell } from "@/components/report/ReportShell";
import { RepoScanNotice } from "@/components/EmptyState";
import { DimensionTrends } from "@/components/report/DimensionTrends";
import { TrajectoryPanel } from "@/app/trends/TrajectoryPanel";
import { ExportCsvButton } from "@/app/trends/ExportCsvButton";
import { TimelineAnnotations } from "@/app/trends/TimelineAnnotations";
import { deriveTrendAnnotations } from "@/app/trends/annotations";
import { deriveDeployAnnotations, mergeTimelineEvents } from "@/app/trends/deployAnnotations";
import { getRepositoryDeployments } from "@/lib/db/repo-deployments";
import { getRepositoryHistory, isDbConfigured } from "@/lib/db";
import type { RepositoryHistory } from "@/lib/db/scans";
import { historyCapNote } from "@/lib/history/limits";
import { readableOrgForOwner } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { historyWindowNote, resolveHistoryWindow } from "@/lib/history/window";
import { historyReturnPath, resolveRepoHistoryAccess } from "@/lib/history/repoHistoryAccess";
import { repoHistoryNotice } from "@/lib/history/repoHistoryNotice";
import { resolveSignInState } from "@/lib/signin-gate";
import { fitTrendForecast, rubricTruncation } from "@/app/trends/forecast";
import { SignInNotice } from "@/components/SignInNotice";
import { LevelBadge } from "@/components/LevelBadge";
import type { LevelId } from "@/lib/types";
import { HEADER_ACTION_LINK_CLASS } from "@/components/report/pill";

export const metadata = {
  title: "Maturity trends · Ascent",
  description:
    "Track a repository's AI-native maturity over time, with per-dimension trends and a forecast of when it reaches the next level.",
};

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return <ReportShell>{children}</ReportShell>;
}

function Notice({ title, body, repo }: { title: string; body: string; repo?: string }) {
  return <RepoScanNotice icon="📈" title={title} body={body} repo={repo} />;
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string }>;
}) {
  const { repo } = await searchParams;

  // The gate used to be `isAuthConfigured() && !session` — the DORMANT custom-OAuth predicate, false in
  // production, so a signed-out visitor was never prompted (and readableOrgForOwner then resolved them
  // to "public", so Trends said "No scans recorded yet"). Check the ACTIVE Supabase wall first.
  const { needsSignIn, provider, expired } = await resolveSignInState();
  if (needsSignIn) {
    return (
      <Shell>
        <SignInNotice next={historyReturnPath("trends", { repo })} provider={provider} expired={expired} />
      </Shell>
    );
  }

  // The shared history ladder (src/lib/history/repoHistoryAccess.ts): parse, database, org, plan window,
  // strict read, db-down, hidden-by-window probe, empty. Read to HISTORY_SCAN_CAP, the SAME depth the
  // CSV export and Compare use (G5-24), and ask for the compacted tail (MOONSHOT #32): this is the one
  // surface whose job is "how has this repo moved over time". DimensionTrends lazy-loads the
  // per-dimension rows client-side, so the first paint reads the overall-only series.
  const access = await resolveRepoHistoryAccess<RepositoryHistory>({
    repo,
    surface: "trends",
    deps: {
      dbConfigured: isDbConfigured(),
      resolveOrg: readableOrgForOwner,
      resolveWindow: async (org) => resolveHistoryWindow(org, await resolveViewerLogin()),
      read: ({ owner, repo: name, orgSlug, limit, since }) =>
        getRepositoryHistory(owner, name, { limit, orgSlug, includeDimensions: false, includeCompacted: true, strict: true, since }),
      probe: async ({ owner, repo: name, orgSlug }) =>
        (await getRepositoryHistory(owner, name, { limit: 1, orgSlug, includeDimensions: false, strict: true }))?.scans.length ?? 0,
    },
  });
  if (access.kind !== "ok") {
    const notice = repoHistoryNotice(access, "trends", "repo" in access ? access.repo : undefined);
    return (
      <Shell>
        <Notice {...notice} />
      </Shell>
    );
  }
  const { data: history, orgSlug, window: historyWindow, target } = access;
  const windowNote = historyWindowNote(historyWindow);

  const latest = history.scans[0]!; // safe: the ladder answers "empty" for a zero-scan series
  // The compare view diffs two real scans, so the "Compare →" affordance counts real scans only: a
  // compacted point has no scan behind it to pick, and offering the link on the strength of one
  // would land the reader on a picker with a single option.
  const retainedCount = history.scans.filter((s) => !s.compacted).length;

  // Forward-looking GPS for THIS repo. Fit over the full history this viewer's plan window reads
  // (everything, when no window applies) — deliberately NOT over the 5d/30d/90d slice the chart below
  // renders. The sold window is the read's access boundary, not a display filter, so the fit never
  // sees rows the plan excludes; the range toggle is a zoom control, and a projection that moves when
  // the viewer zooms is not a projection (G5-01), while a per-range re-fit hands back a confident ETA
  // read off noise (G4-16). `TrajectoryPanel` names the window on screen and refuses to project at all
  // below the shared sample floor.
  const trajectoryWindow = historyWindow.since && historyWindow.days && historyWindow.planLabel
    ? { days: historyWindow.days, planLabel: historyWindow.planLabel }
    : null;
  const forecast = fitTrendForecast(history.scans);
  // Timeline events (band crossings + threshold regressions) derived from the same series.
  const annotations = deriveTrendAnnotations(history.scans);
  // Deploy markers from persisted Deployment rows, read under the SAME org the history was read
  // under: the reader re-applies the history reader's private-repo refusal on its own, so a private
  // repo's deployments never reach this public-capable page. Bounded below by the oldest real scan,
  // the earliest window a deploy can be pinned into.
  const oldestReal = history.scans.filter((s) => !s.compacted).at(-1);
  const deployments = await getRepositoryDeployments(target.owner, target.repo, {
    orgSlug,
    since: oldestReal?.scannedAt ?? null,
  });
  const deployMarkers = deriveDeployAnnotations(history.scans, deployments);
  const timelineEvents = mergeTimelineEvents(annotations, deployMarkers);
  const capNote = historyCapNote(history.scans.length);

  return (
    <Shell>
      <div className="animate-fade-up">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="type-mono-sm uppercase tracking-[0.3em] text-accent">
              Maturity trends
            </div>
            <h1 className="mt-1 type-heading font-bold text-white">{history.repo.fullName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <LevelBadge id={latest.level as LevelId} name={latest.levelName} />
            {retainedCount >= 2 && (
              <Link
                href={`/report/compare?repo=${encodeURIComponent(history.repo.fullName)}`}
                className={HEADER_ACTION_LINK_CLASS}
              >
                Compare →
              </Link>
            )}
            <Link
              href={`/report?repo=${encodeURIComponent(history.repo.fullName)}`}
              className={HEADER_ACTION_LINK_CLASS}
            >
              Full report →
            </Link>
            <ExportCsvButton repo={history.repo.fullName} />
          </div>
        </div>

        {/* One retained scan AND nothing compacted behind it: with a compacted tail present the trend
            lines are already drawn, so the "run another scan" nudge would contradict the chart. */}
        {retainedCount === 1 && history.scans.length === 1 && (
          <p className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 type-body text-slate-400">
            Only a baseline scan so far. The trend lines fill in after the next scan.
          </p>
        )}

        {windowNote && (
          <p className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 type-body-sm text-slate-400">
            {windowNote}
          </p>
        )}

        {capNote && (
          <p className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 type-body-sm text-slate-400">
            {capNote}
          </p>
        )}

        <div className="mt-8">
          <TrajectoryPanel forecast={forecast} scanCount={history.scans.length} rubricRun={rubricTruncation(history.scans)} window={trajectoryWindow} />
        </div>

        <div className="mt-8">
          <DimensionTrends history={history} annotations={annotations} deployMarkers={deployMarkers} />
          <TimelineAnnotations annotations={timelineEvents} repoFullName={history.repo.fullName} />
        </div>
      </div>
    </Shell>
  );
}
