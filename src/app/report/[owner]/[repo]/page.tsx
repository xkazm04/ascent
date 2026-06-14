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
import { getScanReportByCommit, getSkillHistory, diffTrackSets } from "@/lib/db";
import { readableOrgForOwner } from "@/lib/auth";
import { PRACTICES } from "@/lib/practices";

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
  // STD-6: onboarding-skill generation history for this repo (only meaningful for a persisted report).
  const skillHistory = pinned ? await getSkillHistory(ref).catch(() => []) : [];

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
        {skillHistory.length > 0 && <SkillHistorySection rows={skillHistory} />}
      </main>
      <SiteFooter />
    </>
  );
}

/** STD-6: a compact "onboarding skill over time" panel — most-recent track set + what changed since
 *  the prior generation — turning the one-off SKILL.md download into a visible, tracked program. */
function SkillHistorySection({ rows }: { rows: { headSha: string | null; trackIds: string[]; generatedAt: string }[] }) {
  const labelFor = (id: string) => PRACTICES.find((p) => p.id === id)?.label ?? id;
  const latest = rows[0]!; // rows is non-empty (guarded by the caller)
  const prev = rows[1];
  const diff = prev ? diffTrackSets(prev.trackIds, latest.trackIds) : null;
  return (
    <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <h2 className="text-base font-semibold text-white">
        Onboarding skill <span className="font-normal text-slate-500">· generated {rows.length}× · last {latest.generatedAt.slice(0, 10)}</span>
      </h2>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {latest.trackIds.length === 0 ? (
          <span className="text-sm text-slate-500">No open tracks — the skill targeted no gaps at last generation.</span>
        ) : (
          latest.trackIds.map((id) => (
            <span key={id} className="rounded-full border border-slate-700 bg-slate-950/40 px-2.5 py-0.5 font-mono text-sm text-slate-300">
              {labelFor(id)}
            </span>
          ))
        )}
      </div>
      {diff && (diff.added.length > 0 || diff.dropped.length > 0) && (
        <p className="mt-3 font-mono text-sm">
          {diff.added.length > 0 && <span className="text-emerald-300">+ {diff.added.map(labelFor).join(", ")}</span>}
          {diff.added.length > 0 && diff.dropped.length > 0 && <span className="text-slate-600"> · </span>}
          {diff.dropped.length > 0 && <span className="text-slate-500">✓ done: {diff.dropped.map(labelFor).join(", ")}</span>}
          <span className="text-slate-600"> since the prior generation</span>
        </p>
      )}
    </section>
  );
}
