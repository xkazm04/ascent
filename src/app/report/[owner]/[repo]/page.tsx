// Stable, shareable permalink: /report/{owner}/{repo} or /report/{owner}/{repo}@{headSha}.
// When the snapshot is persisted it's served pinned (server-rendered, no re-scan); otherwise
// we fall back to a fresh live scan so the link always resolves. The co-located
// opengraph-image.tsx makes it unfurl richly in Slack / X / GitHub.

import { Suspense } from "react";
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { ReportClient } from "@/components/report/ReportClient";
import { ReportView } from "@/components/report/ReportView";
import { ReportSkeleton } from "@/components/report/ReportSkeleton";
import { ReportErrorBoundary } from "@/components/report/ReportErrorBoundary";
import { getScanReportByCommit } from "@/lib/db";
import { readableOrgForOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Split a `repo` path segment that may carry a pinned commit: `name` or `name@sha`. */
function parseRepoParam(repoParam: string): { name: string; sha?: string } {
  const at = repoParam.indexOf("@");
  if (at < 0) return { name: repoParam };
  return { name: repoParam.slice(0, at), sha: repoParam.slice(at + 1) || undefined };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}): Promise<Metadata> {
  const { owner, repo } = await params;
  const { name, sha } = parseRepoParam(repo);
  const ref = `${owner}/${name}`;
  const orgSlug = await readableOrgForOwner(owner);
  const report = await getScanReportByCommit(owner, name, { headSha: sha, orgSlug }).catch(() => null);

  const title = report
    ? `${ref} — ${report.level.id} ${report.level.name} · Ascent`
    : `${ref} — AI-native maturity · Ascent`;
  const description = report
    ? `${ref} scores ${report.overallScore}/100 (${report.level.id} ${report.level.name}) on Ascent's AI-native maturity index${sha ? ` at ${sha.slice(0, 7)}` : ""}.`
    : `See ${ref}'s AI-native engineering maturity on Ascent — a 5-level ladder with evidence and a route to the next level.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ReportPermalink({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const { name, sha } = parseRepoParam(repo);
  const ref = `${owner}/${name}`;
  const orgSlug = await readableOrgForOwner(owner);
  const pinned = await getScanReportByCommit(owner, name, { headSha: sha, orgSlug }).catch(() => null);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-5 py-10">
        {pinned ? (
          <ReportErrorBoundary>
            <ReportView report={pinned} />
          </ReportErrorBoundary>
        ) : (
          <Suspense fallback={<div className="mx-auto w-full max-w-md py-12"><ReportSkeleton /></div>}>
            <ReportClient repo={ref} />
          </Suspense>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
