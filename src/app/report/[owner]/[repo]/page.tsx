// Stable, shareable permalink: /report/{owner}/{repo} or /report/{owner}/{repo}@{headSha}.
// When the snapshot is persisted it's served pinned (server-rendered, no re-scan); otherwise
// we fall back to a fresh live scan so the link always resolves. The co-located
// opengraph-image.tsx makes it unfurl richly in Slack / X / GitHub.

import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportShell } from "@/components/report/ReportShell";
import { ColdScanGate } from "@/components/report/ColdScanGate";
import { ReportView } from "@/components/report/ReportView";
import { PassportCard } from "@/components/org/PassportCard";
import { ReportErrorBoundary } from "@/components/report/ReportErrorBoundary";
import { Kicker } from "@/components/ui";
import { getScanReportByCommit, getRepoPassport, getSkillHistory, diffTrackSets } from "@/lib/db";
import { PUBLIC_ORG, readableOrgForOwner } from "@/lib/auth";
import { hasOrgRole, canReadOrg } from "@/lib/authz";
import { PRACTICES } from "@/lib/practices";
import { parseRepoParam } from "./repoParam";

export const dynamic = "force-dynamic";

/** Resolve the org a report is read under. An explicit `?org={slug}` wins when the viewer may read it
 *  — an in-app link from a dashboard whose org SLUG differs from the repo OWNER login (e.g. a rebranded
 *  org) uses it so the report resolves under the owning tenant instead of dead-ending on the owner→
 *  public fallback. Gated by canReadOrg, so the hint can never reach another tenant's private report;
 *  without it (external/shared links), it falls back to owner→readable-org, unchanged. */
async function resolveReportOrg(owner: string, sp: { org?: string | string[] | undefined }): Promise<string> {
  const hint = typeof sp.org === "string" ? sp.org.trim().toLowerCase() : undefined;
  if (hint && (await canReadOrg(hint))) return hint;
  return readableOrgForOwner(owner);
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const { owner, repo } = await params;
  const { name, sha } = parseRepoParam(repo);
  const ref = `${owner}/${name}`;
  const orgSlug = await resolveReportOrg(owner, await searchParams);
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
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Only the route params are awaited here (they resolve instantly) — enough to paint the brand chrome
  // and the repo masthead from the URL right away. The report itself (a DB read, or a live-scan fallback)
  // streams into the Suspense boundary below, so navigating to a permalink shows real content instantly
  // instead of a full-page skeleton that blinks and then swaps. There is no loading.tsx for this segment:
  // the Suspense fallback IS the instant masthead, and the resolved body fades in over it.
  const { owner, repo } = await params;
  const { name, sha } = parseRepoParam(repo);
  const ref = `${owner}/${name}`;

  return (
    <ReportShell>
      <Suspense fallback={<ReportMasthead repoRef={ref} loading />}>
        <ReportPermalinkBody owner={owner} name={name} sha={sha} repoRef={ref} searchParams={searchParams} />
      </Suspense>
    </ReportShell>
  );
}

/**
 * The data-dependent report body — resolved off the request's DB reads and streamed in via Suspense.
 * Its sections fade up with a small per-section stagger so the report assembles component-by-component
 * (masthead already painted → report → passport → skill history) rather than popping in as one block.
 * ReportView additionally loads its own dynamic sub-parts (passport hero, trend, roadmap) client-side,
 * giving a natural second wave of progressive reveal.
 */
async function ReportPermalinkBody({
  owner,
  name,
  sha,
  repoRef,
  searchParams,
}: {
  owner: string;
  name: string;
  sha?: string;
  repoRef: string;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const orgSlug = await resolveReportOrg(owner, await searchParams);
  const pinned = await getScanReportByCommit(owner, name, { headSha: sha, orgSlug }).catch(() => null);

  // No persisted snapshot: confirm before launching a multi-minute live scan, so a shared / example
  // permalink doesn't auto-scan a repo the visitor only meant to view.
  if (!pinned) return <ColdScanGate repo={repoRef} />;

  // STD-6 skill history + the App Readiness Passport (P2) are independent of each other, so fetch them
  // concurrently instead of in series — this force-dynamic permalink is the most-shared URL, where TTFB
  // (unfurl / first paint) matters most. Both are gated identically to the report via the same orgSlug,
  // so a private passport never leaks. canEditPassport still awaits after, as it depends on `passport`.
  const [skillHistory, passport] = await Promise.all([
    getSkillHistory(repoRef).catch(() => []),
    getRepoPassport(owner, name, { orgSlug, headSha: sha }).catch(() => null),
  ]);
  // Owner-only passport controls (P4): editable only for a non-public org-owned repo by an owner.
  const canEditPassport = Boolean(passport) && orgSlug !== PUBLIC_ORG && (await hasOrgRole(orgSlug, "owner").catch(() => false));

  return (
    <ReportErrorBoundary>
      {/* ReportView carries its own animate-fade-up entrance (and its own repo header, which lands over
          the masthead at the same position). The panels below stagger in after it. */}
      <ReportView report={pinned} />
      {passport && (
        <div className="mt-8 animate-fade-up" style={{ animationDelay: "120ms" }}>
          <PassportCard passport={passport} repo={repoRef} canEdit={canEditPassport} />
        </div>
      )}
      {skillHistory.length > 0 && (
        <div className="animate-fade-up" style={{ animationDelay: "200ms" }}>
          <SkillHistorySection rows={skillHistory} />
        </div>
      )}
    </ReportErrorBoundary>
  );
}

/** Instant repo masthead — derived purely from the URL, so it paints with zero data dependency. Doubles
 *  as the Suspense fallback (with a calm "reading…" line, never a pulsing skeleton) and is replaced in
 *  place by ReportView's own header — which repeats the same Kicker + title at the same position — when
 *  the report streams in, so the title never jumps. */
function ReportMasthead({ repoRef, loading = false }: { repoRef: string; loading?: boolean }) {
  return (
    <div className="animate-fade-up">
      <Kicker tone="muted">Repository report</Kicker>
      <h1 className="mt-2 text-2xl font-bold text-white">{repoRef}</h1>
      {loading && (
        <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
          <span aria-hidden className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Reading the latest scan…
        </p>
      )}
    </div>
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
