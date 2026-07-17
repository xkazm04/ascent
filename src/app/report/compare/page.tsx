import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { RepoScanNotice } from "@/components/EmptyState";
import { ScanComparePicker } from "@/components/report/ScanComparePicker";
import { WhatChanged } from "@/components/report/WhatChanged";
import { parseRepoUrl } from "@/lib/github/source";
import { getScanComparison, isDbConfigured } from "@/lib/db";
import { readableOrgForOwner } from "@/lib/auth";
import { resolveSignInState } from "@/lib/signin-gate";
import { SignInNotice } from "@/components/SignInNotice";
import { diffScans } from "@/lib/report/compare";

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-5xl px-5 py-10">{children}</main>
      <SiteFooter />
    </>
  );
}

function Notice({ title, body, repo }: { title: string; body: string; repo?: string }) {
  return <RepoScanNotice icon="🔀" title={title} body={body} repo={repo} />;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string; a?: string; b?: string }>;
}) {
  const { repo, a, b } = await searchParams;

  // The gate used to be `isAuthConfigured() && !session` — the DORMANT custom-OAuth predicate, false in
  // production, so a signed-out visitor was never prompted (and readableOrgForOwner then resolved them
  // to "public", so the page said "no scans"). resolveSignInState checks the ACTIVE Supabase wall first.
  const { needsSignIn, provider, expired } = await resolveSignInState();
  if (needsSignIn) {
    return (
      <Shell>
        <SignInNotice
          next={repo ? `/report/compare?repo=${encodeURIComponent(repo)}` : "/report/compare"}
          provider={provider}
          expired={expired}
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

  // Requested ids the server did NOT honor (trends-comparison 07-16 #2). getScanComparison resolves
  // ?a/?b only within the newest-`limit` window, so a bookmarked compare URL whose scan aged past the
  // 60th slot (retention keeps ~200), a stale/mistyped id, or the degenerate a===b fall back to the
  // default pair — previously with ZERO indication, silently breaking the shareable-URL contract
  // (the saved link later shows different numbers). Detect the substitution here by comparing the
  // requested ids against the resolved pair and say so above the picker.
  const unhonored = [
    a && after.id !== a ? a : null,
    b && before.id !== b ? b : null,
  ].filter((x): x is string => x !== null);

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

        {unhonored.length > 0 && (
          <p
            role="status"
            className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-base text-amber-200/90"
          >
            <span aria-hidden>ⓘ </span>
            {unhonored.length === 1
              ? `The requested scan ${unhonored[0]} is no longer in the comparison window (or doesn't belong to this repo)`
              : `The requested scans ${unhonored.join(" and ")} are no longer in the comparison window (or don't belong to this repo)`}
            {" — showing the default comparison instead. Pick the scans you want below."}
          </p>
        )}

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
