import Link from "next/link";
import { ReportShell } from "@/components/report/ReportShell";
import { RepoScanNotice } from "@/components/EmptyState";
import { DimensionTrends } from "@/components/report/DimensionTrends";
import { TrajectoryPanel } from "@/app/trends/TrajectoryPanel";
import { ExportCsvButton } from "@/app/trends/ExportCsvButton";
import { TimelineAnnotations } from "@/app/trends/TimelineAnnotations";
import { deriveTrendAnnotations } from "@/app/trends/annotations";
import { parseRepoUrl } from "@/lib/github/source";
import { getRepositoryHistory, isDbConfigured } from "@/lib/db";
import { HISTORY_SCAN_CAP, historyCapNote } from "@/lib/history/limits";
import { readableOrgForOwner } from "@/lib/auth";
import { resolveSignInState } from "@/lib/signin-gate";
import { fitTrendForecast } from "@/app/trends/forecast";
import { SignInNotice } from "@/components/SignInNotice";
import { LevelBadge } from "@/components/LevelBadge";
import type { LevelId } from "@/lib/types";
import { HEADER_ACTION_LINK_CLASS } from "@/components/report/pill";

export const metadata = {
  title: "Maturity trends — Ascent",
  description:
    "Track a repository's AI-native maturity over time — per-dimension trends and a forecast of when it reaches the next level.",
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
        <SignInNotice
          next={repo ? `/trends?repo=${encodeURIComponent(repo)}` : "/trends"}
          provider={provider}
          expired={expired}
        />
      </Shell>
    );
  }

  if (!repo) {
    return (
      <Shell>
        <Notice title="No repository specified" body="Add ?repo=owner/repo to see its maturity trends." />
      </Shell>
    );
  }
  const parsed = parseRepoUrl(repo);
  if (!parsed) {
    return (
      <Shell>
        <Notice title="Invalid repository" body="Use the form owner/repo or a GitHub URL." />
      </Shell>
    );
  }
  if (!isDbConfigured()) {
    return (
      <Shell>
        <Notice
          title="Trends need a database"
          body="Progress tracking is a Phase 2 feature — set DATABASE_URL (local Postgres or Aurora DSQL) to record scan history."
          repo={`${parsed.owner}/${parsed.repo}`}
        />
      </Shell>
    );
  }

  const orgSlug = await readableOrgForOwner(parsed.owner);
  // Lightweight first paint: fetch the overall-only series (no per-dimension fan-out) for the page
  // shell + overall chart. DimensionTrends lazy-loads the per-dimension rows client-side (via
  // /api/history) when its section nears the viewport.
  // Fetch to the SAME depth the CSV export uses (HISTORY_SCAN_CAP). The page used to stop at 60 while
  // `?format=csv` pulled 200, so "All" was a silent truncation: the chart and the spreadsheet
  // downloaded from the button beside it described different histories, with nothing saying so
  // (G5-24). One cap now, and `historyCapNote` says out loud when even that cap is binding.
  const history = await getRepositoryHistory(parsed.owner, parsed.repo, {
    limit: HISTORY_SCAN_CAP,
    orgSlug,
    includeDimensions: false,
  });
  if (!history || history.scans.length === 0) {
    return (
      <Shell>
        <Notice
          title="No scans recorded yet"
          body={`We haven't stored any scans for ${parsed.owner}/${parsed.repo}. Run a scan to start the trend.`}
          repo={`${parsed.owner}/${parsed.repo}`}
        />
      </Shell>
    );
  }

  const latest = history.scans[0]!; // safe: history.scans.length === 0 returned above

  // Forward-looking GPS for THIS repo. Fit over the FULL fetched history — deliberately NOT over the
  // 5d/30d/90d slice the chart below renders. The range toggle is a zoom control; a projection that
  // moves when the viewer zooms is not a projection (G5-01), and re-fitting per range is exactly what
  // makes a 5-day window hand back a confident ETA read off noise (G4-16). `TrajectoryPanel` states
  // the basis on screen and refuses to project at all below the shared sample floor.
  const forecast = fitTrendForecast(history.scans);
  // Timeline events (band crossings + threshold regressions) derived from the same series.
  const annotations = deriveTrendAnnotations(history.scans);
  const capNote = historyCapNote(history.scans.length);

  return (
    <Shell>
      <div className="animate-fade-up">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">
              Maturity trends
            </div>
            <h1 className="mt-1 text-2xl font-bold text-white">{history.repo.fullName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <LevelBadge id={latest.level as LevelId} name={latest.levelName} />
            {history.scans.length >= 2 && (
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

        {history.scans.length === 1 && (
          <p className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-base text-slate-400">
            Only a baseline scan so far — the trend lines fill in after the next scan.
          </p>
        )}

        {capNote && (
          <p className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
            {capNote}
          </p>
        )}

        <div className="mt-8">
          <TrajectoryPanel forecast={forecast} scanCount={history.scans.length} />
        </div>

        <div className="mt-8">
          <DimensionTrends history={history} annotations={annotations} />
          <TimelineAnnotations annotations={annotations} repoFullName={history.repo.fullName} />
        </div>
      </div>
    </Shell>
  );
}
