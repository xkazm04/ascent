// Stable, shareable permalink: /report/{owner}/{repo} or /report/{owner}/{repo}@{headSha}.
// When the snapshot is persisted it's served pinned (server-rendered, no re-scan); otherwise
// we fall back to a fresh live scan so the link always resolves. The co-located
// opengraph-image.tsx makes it unfurl richly in Slack / X / GitHub.

import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportShell } from "@/components/report/ReportShell";
import { ColdScanGate } from "@/components/report/ColdScanGate";
import { ReportView } from "@/components/report/ReportView";
import { PassportCard } from "@/features/standing/passports/PassportCard";
import { ReportErrorBoundary } from "@/components/report/ReportErrorBoundary";
import { Kicker } from "@/components/ui";
import {
  getScanReportByCommit,
  getRepoPassport,
  getSkillHistory,
  getRepositoryHistory,
  getLatestRecommendations,
  diffTrackSets,
  type RepositoryHistory,
} from "@/lib/db";
import { PUBLIC_ORG, isAuthConfigured, readableOrgForOwner } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
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
    ? `${ref}: ${report.level.id} ${report.level.name} · Ascent`
    : `${ref}: AI-native maturity · Ascent`;
  const description = report
    ? `${ref} scores ${report.overallScore}/100 (${report.level.id} ${report.level.name}) on Ascent's AI-native maturity index${sha ? ` at ${sha.slice(0, 7)}` : ""}.`
    : `See ${ref}'s AI-native engineering maturity on Ascent, a 5-level ladder with evidence and a route to the next level.`;

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
 * ReportView's data-dependent sub-parts (passport hero, trend, roadmap) are served from HERE as props
 * rather than re-fetched after hydration, so they're part of that first paint too.
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
  // permalink doesn't auto-scan a repo the visitor only meant to view. Keep the pinned `@sha` on the
  // ref handed to the gate — dropping it made "Scan now" score HEAD while the browser URL still read
  // …@{sha}, presenting a HEAD report under a commit-pinned permalink (the same bug FreshnessControl
  // was fixed for; the scan flow accepts the owner/name@sha grammar). (repo-report-shell-tabs 07-16 #1)
  if (!pinned) return <ColdScanGate repo={sha ? `${repoRef}@${sha}` : repoRef} />;

  // STD-6 skill history, the App Readiness Passport (P2), and the two series ReportView used to fetch
  // AFTER hydration (scan history / persisted recommendations) are independent of each other, so fetch
  // them concurrently instead of in series — this force-dynamic permalink is the most-shared URL, where
  // TTFB (unfurl / first paint) matters most. All are gated identically to the report via the same
  // orgSlug, so a private passport never leaks. canEditPassport still awaits after, as it depends on
  // `passport`.
  //
  // The last two exist purely to kill the post-hydration fetch wave: this component already holds the
  // DB session, yet ReportView re-asked the server for the passport (on EVERY permalink — a DB-rebuilt
  // report never carries one), history and recommendations over HTTP a beat after paint, so the hero
  // popped in late. They call the SAME readers the three API routes compose, under the same org
  // resolution and the same access gate, so the served data is identical — just already in the HTML.
  const [skillHistory, passport, history, recs] = await Promise.all([
    getSkillHistory(repoRef).catch(() => []),
    getRepoPassport(owner, name, { orgSlug, headSha: sha }).catch(() => null),
    readReportHistory(owner, name, orgSlug),
    readReportRecommendations(owner, name),
  ]);
  // Owner-only passport controls (P4): editable only for a non-public org-owned repo by an owner.
  const canEditPassport = Boolean(passport) && orgSlug !== PUBLIC_ORG && (await hasOrgRole(orgSlug, "owner").catch(() => false));
  // The .ai/ foundation install-PR button: any org MEMBER of a non-public repo (mirrors the route's
  // requireOrgAccess — member-level, unlike the owner-only passport controls). UX courtesy only; the
  // route re-checks access and the App installation before writing anything.
  const canInstallFoundation = orgSlug !== PUBLIC_ORG && (await hasOrgRole(orgSlug, "member").catch(() => false));

  return (
    // No onRetry: this is the pinned-permalink reader (deterministic, persisted data), so the boundary
    // renders a terminal "scan fresh" escape hatch instead of a reload button that would re-crash on
    // the same bad snapshot (G6-03). repoRef carries the pinned @sha (when present) so "scan fresh"
    // targets the exact commit the visitor was viewing, same grammar as FreshnessControl's re-test link.
    <ReportErrorBoundary repoRef={sha ? `${repoRef}@${sha}` : repoRef}>
      {/* ReportView carries its own animate-fade-up entrance (and its own repo header, which lands over
          the masthead at the same position). The panels below stagger in after it. */}
      <ReportView
        report={pinned}
        serverPassport={passport}
        serverHistory={history}
        serverRecs={recs}
        installFoundation={canInstallFoundation}
      />
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

/**
 * The repo's scan history, server-side — the same `getRepositoryHistory` read GET /api/history serves,
 * under the same org scope AND the same sign-in gate that route applies, so server-rendering it can't
 * widen who sees a trend line. Returns `null` when the gate blocks it (or the read fails), which leaves
 * ReportView on its existing client fetch → 401 → quiet-baseline path, exactly as before. When the gate
 * passes we mirror the route's empty-history fallback so "no history yet" is an ANSWER (no refetch)
 * rather than an absent prop.
 */
async function readReportHistory(owner: string, name: string, orgSlug: string): Promise<RepositoryHistory | null> {
  if ((authGateEnabled() || isAuthConfigured()) && !(await resolveViewerLogin().catch(() => null))) return null;
  const history = await getRepositoryHistory(owner, name, { orgSlug }).catch(() => null);
  return history ?? { repo: { owner, name, fullName: `${owner}/${name}` }, scans: [] };
}

/**
 * The latest scan's persisted recommendations, server-side — the same `getLatestRecommendations` read
 * GET /api/recommendations serves. Its org resolution deliberately mirrors that route's (owner-as-slug
 * when readable, else the public org) rather than reusing the report's `orgSlug`: the report resolves
 * via the dormant-session `readableOrgForOwner`, which under-permissions a private-org member and would
 * hand back an empty list where the client fetch found the real tracker.
 */
async function readReportRecommendations(owner: string, name: string) {
  const ownerOrg = owner.toLowerCase();
  const orgSlug = (await canReadOrg(ownerOrg).catch(() => false)) ? ownerOrg : PUBLIC_ORG;
  const result = await getLatestRecommendations(owner, name, { orgSlug }).catch(() => null);
  return result?.items ?? [];
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
          <span className="text-sm text-slate-500">No open tracks. The skill targeted no gaps at last generation.</span>
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
