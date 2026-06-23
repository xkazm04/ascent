import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { EmptyState } from "@/components/EmptyState";
import { ScanComparePicker } from "@/components/report/ScanComparePicker";
import { WhatChanged } from "@/components/report/WhatChanged";
import { parseRepoUrl } from "@/lib/github/source";
import { getScanComparison, isDbConfigured } from "@/lib/db";
import { getSessionState, isAuthConfigured, readableOrgForOwner } from "@/lib/auth";
import { SignInNotice } from "@/components/SignInNotice";
import { diffScans } from "@/lib/report/compare";

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
      icon="🔀"
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

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string; a?: string; b?: string }>;
}) {
  const { repo, a, b } = await searchParams;

  const { session, status } = await getSessionState();
  if (isAuthConfigured() && !session) {
    return (
      <Shell>
        <SignInNotice
          next={repo ? `/report/compare?repo=${encodeURIComponent(repo)}` : "/report/compare"}
          expired={status === "expired"}
        />
      </Shell>
    );
  }

  if (!repo) {
    return (
      <Shell>
        <Notice title="No repository specified" body="Add ?repo=owner/repo to compare its scans." />
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
          title="Comparison needs a database"
          body="Scan history is a Phase 2 feature — set DATABASE_URL (local Postgres or Aurora DSQL) to record scans and compare them."
          repo={`${parsed.owner}/${parsed.repo}`}
        />
      </Shell>
    );
  }

  const orgSlug = await readableOrgForOwner(parsed.owner);
  const comparison = await getScanComparison(parsed.owner, parsed.repo, {
    orgSlug,
    afterId: a,
    beforeId: b,
    limit: 60,
  });

  if (!comparison || comparison.scans.length === 0) {
    return (
      <Shell>
        <Notice
          title="No scans recorded yet"
          body={`We haven't stored any scans for ${parsed.owner}/${parsed.repo}. Run a scan to start tracking changes.`}
          repo={`${parsed.owner}/${parsed.repo}`}
        />
      </Shell>
    );
  }

  if (comparison.scans.length < 2 || !comparison.before || !comparison.after) {
    return (
      <Shell>
        <Notice
          title="Need two scans to compare"
          body={`Only one scan is stored for ${comparison.repo.fullName}. Re-scan after making changes, then come back to see what moved.`}
          repo={comparison.repo.fullName}
        />
      </Shell>
    );
  }

  const { before, after } = comparison;
  const diff = diffScans(before, after);
  const repoRef = comparison.repo.fullName;

  return (
    <Shell>
      <div className="animate-fade-up space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Scan comparison</div>
            <h1 className="mt-1 text-2xl font-bold text-white">{repoRef}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/trends?repo=${encodeURIComponent(repoRef)}`}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-base text-slate-300 hover:border-accent hover:text-white"
            >
              Trends →
            </Link>
            <Link
              href={`/report?repo=${encodeURIComponent(repoRef)}`}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-base text-slate-300 hover:border-accent hover:text-white"
            >
              Full report →
            </Link>
          </div>
        </div>

        <ScanComparePicker
          repo={repoRef}
          scans={comparison.scans}
          beforeId={before.id}
          afterId={after.id}
        />

        <WhatChanged diff={diff} before={before} after={after} />
      </div>
    </Shell>
  );
}
