import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { EmptyState } from "@/components/EmptyState";
import { DimensionTrends } from "@/components/report/DimensionTrends";
import { parseRepoUrl } from "@/lib/github/source";
import { getRepositoryHistory, isDbConfigured } from "@/lib/db";
import { getSessionState, isAuthConfigured, readableOrgForOwner } from "@/lib/auth";
import { SignInNotice } from "@/components/SignInNotice";
import { LEVEL_CLASSES } from "@/lib/ui";
import type { LevelId } from "@/lib/types";

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-5 py-10">{children}</main>
      <SiteFooter />
    </>
  );
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
  const lc = LEVEL_CLASSES[latest.level as LevelId] ?? LEVEL_CLASSES.L1;

  return (
    <Shell>
      <div className="animate-fade-up">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">
              Maturity trends
            </div>
            <h1 className="mt-1 text-2xl font-bold text-white">{history.repo.fullName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border ${lc.border} ${lc.bg} px-3 py-1 text-sm font-semibold ${lc.text}`}>
              {latest.level} · {latest.levelName}
            </span>
            {history.scans.length >= 2 && (
              <Link
                href={`/report/compare?repo=${encodeURIComponent(history.repo.fullName)}`}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-accent hover:text-white"
              >
                Compare →
              </Link>
            )}
            <Link
              href={`/report?repo=${encodeURIComponent(history.repo.fullName)}`}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-accent hover:text-white"
            >
              Full report →
            </Link>
          </div>
        </div>

        {history.scans.length === 1 && (
          <p className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
            Only a baseline scan so far — the trend lines fill in after the next scan.
          </p>
        )}

        <div className="mt-8">
          <DimensionTrends history={history} />
        </div>
      </div>
    </Shell>
  );
}
