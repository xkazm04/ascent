import Link from "next/link";
import { ReportShell } from "@/components/report/ReportShell";
import { EmptyState } from "@/components/EmptyState";
import { DimensionTrends } from "@/components/report/DimensionTrends";
import { Trajectory } from "@/components/org/Trajectory";
import { parseRepoUrl } from "@/lib/github/source";
import { getRepositoryHistory, isDbConfigured } from "@/lib/db";
import { getSessionState, isAuthConfigured, readableOrgForOwner } from "@/lib/auth";
import { forecastTrajectory } from "@/lib/maturity/forecast";
import { SignInNotice } from "@/components/SignInNotice";
import { LevelBadge } from "@/components/LevelBadge";
import type { LevelId } from "@/lib/types";

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
  return (
    <EmptyState
      icon="📈"
      title={title}
      body={body}
      actions={[
        ...(repo
          ? [{ label: `Scan ${repo}`, href: `/report?repo=${encodeURIComponent(repo)}`, primary: true }]
          : []),
        { label: "← Home", href: "/" },
      ]}
    />
  );
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string }>;
}) {
  const { repo } = await searchParams;

  const { session, status } = await getSessionState();
  if (isAuthConfigured() && !session) {
    return (
      <Shell>
        <SignInNotice
          next={repo ? `/trends?repo=${encodeURIComponent(repo)}` : "/trends"}
          expired={status === "expired"}
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
  const history = await getRepositoryHistory(parsed.owner, parsed.repo, {
    limit: 60,
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

  const latest = history.scans[0];

  // Forward-looking GPS for THIS repo — the same trajectory fit the org rollup already renders,
  // but the per-repo trends page only ever drew rear-view lines. Fit over the (overall-only)
  // history we already fetched; null until there are two distinct scan days to fit a line through,
  // which lines up with the single-scan "baseline only" note below.
  const forecast = forecastTrajectory(
    history.scans.map((s) => ({ date: s.scannedAt, value: s.overallScore })),
  );

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
                className="focus-ring rounded-lg border border-slate-700 px-3 py-1.5 text-base text-slate-300 hover:border-accent hover:text-white"
              >
                Compare →
              </Link>
            )}
            <Link
              href={`/report?repo=${encodeURIComponent(history.repo.fullName)}`}
              className="focus-ring rounded-lg border border-slate-700 px-3 py-1.5 text-base text-slate-300 hover:border-accent hover:text-white"
            >
              Full report →
            </Link>
            <a
              href={`/api/history?repo=${encodeURIComponent(history.repo.fullName)}&format=csv`}
              className="focus-ring rounded-lg border border-slate-700 px-3 py-1.5 text-base text-slate-300 hover:border-accent hover:text-white"
              title="Download this repo's scan history as CSV"
            >
              Export CSV ↓
            </a>
          </div>
        </div>

        {history.scans.length === 1 && (
          <p className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-base text-slate-400">
            Only a baseline scan so far — the trend lines fill in after the next scan.
          </p>
        )}

        {forecast && (
          <div className="mt-8">
            <Trajectory forecast={forecast} />
          </div>
        )}

        <div className="mt-8">
          <DimensionTrends history={history} />
        </div>
      </div>
    </Shell>
  );
}
