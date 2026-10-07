// Stable, shareable permalink: /report/{owner}/{repo} or /report/{owner}/{repo}@{headSha}.
// A persisted snapshot is served pinned (no re-scan). A true miss is ColdScanGate. A thrown
// read is PermalinkReadError — never a live scan on a persistence blip. The co-located
// opengraph-image.tsx makes it unfurl richly in Slack / X / GitHub.
//
// Every server read below separates a FAILED read from an empty answer, and every failure reaches a
// door (src/lib/scan-read-door.ts). A failed read whose prop ReportView can fetch for itself stays
// `undefined` so the client fetch and its own error door take over; `null` / `[]` are reserved for
// what the store actually answered.

import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportShell } from "@/components/report/ReportShell";
import { ColdScanGate, PermalinkReadError } from "@/components/report/ColdScanGate";
import { ReportClient } from "@/components/report/ReportClient";
import { ReportView } from "@/components/report/ReportView";
import { ReportErrorBoundary } from "@/components/report/ReportErrorBoundary";
import {
  getScanReportByCommit,
  getRepoPassport,
  getSkillHistory,
  getRepositoryHistory,
  getLatestRecommendations,
  getHeadHint,
  type RepositoryHistory,
} from "@/lib/db";
import { PUBLIC_ORG, isAuthConfigured, readableOrgForOwner } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { hasOrgRole, canReadOrg } from "@/lib/authz";
import { EMPTY_LIFTS, getOrgExpectedLifts } from "@/lib/outcomes/expected-lift-load";
import { scanMaxCacheAgeMs } from "@/lib/scan-cache";
import { degradeTo, reportDegradedRead, reportFailedRead } from "@/lib/scan-read-door";
import { parseRepoParam } from "./repoParam";
import { reportMetadata } from "./reportMetadata";
import { PermalinkPanels, ReportMasthead } from "./PermalinkPanels";

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

/** Successful empty = never scanned. A throw = unavailable, not cold (G4) — and reported, so the
 *  operator learns of the blip the reader was shown. `strict` makes a CONFIGURED-but-unreachable DB a
 *  throw too (the default reader resolves it null, which would read as "never scanned" and offer a
 *  metered Scan now). An UNCONFIGURED DB (the keyless MVP) still answers null: there is no corpus. */
async function readPermalinkReport(owner: string, name: string, sha: string | undefined, orgSlug: string) {
  try {
    const report = await getScanReportByCommit(owner, name, { headSha: sha, orgSlug, strict: true });
    return report ? ({ kind: "ok" as const, report }) : ({ kind: "empty" as const });
  } catch (err) {
    reportFailedRead("report permalink: getScanReportByCommit", err);
    return { kind: "unavailable" as const };
  }
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
  const orgSlug = await resolveReportOrg(owner, await searchParams);
  const read = await readPermalinkReport(owner, name, sha, orgSlug);
  // ./reportMetadata dates a stale reading: an unfurl is read by people who never open the app.
  return reportMetadata({
    ref: `${owner}/${name}`,
    report: read.kind === "ok" ? read.report : null,
    lookupFailed: read.kind === "unavailable",
    sha,
  });
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
  const sp = await searchParams;
  // Permalink Re-test stays here (`?fresh=1` only). Bouncing to `/report?repo=` dropped the durable URL.
  if (sp.fresh === "1" || sp.fresh === "true") return <ReportClient repo={sha ? `${repoRef}@${sha}` : repoRef} />;
  const orgSlug = await resolveReportOrg(owner, sp);
  const read = await readPermalinkReport(owner, name, sha, orgSlug);
  const scanRef = sha ? `${repoRef}@${sha}` : repoRef;
  // G4: a thrown read is not an empty corpus — do not invite a metered live scan on a blip.
  if (read.kind === "unavailable") return <PermalinkReadError repo={scanRef} />;
  if (read.kind === "empty") return <ColdScanGate repo={scanRef} />;
  const pinned = read.report;

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
  // The fifth read is the FRESHNESS PROVENANCE: `Repository.headSha` (the head last seen) against the
  // scan's own, which is the drift fact the masthead states. A DB read, so it costs no GitHub call.
  const [skillHistory, passport, history, recs, headHint] = await Promise.all([
    // `undefined` = the read FAILED: the skill section says so, and ReportView's own passport fetch
    // takes over. `[]` / `null` are the store's answers (none yet / proved none), never a failure.
    readOrUnresolved("getSkillHistory", () => getSkillHistory(repoRef)),
    readOrUnresolved("getRepoPassport", () => getRepoPassport(owner, name, { orgSlug, headSha: sha, strict: true })),
    readReportHistory(owner, name, orgSlug),
    readReportRecommendations(owner, name),
    readLastSeenHead(owner, name, orgSlug),
  ]);
  // The three role probes below are UX courtesy only (every route they unlock re-checks access), so a
  // thrown probe degrades to "not permitted" — fail closed, and reported rather than dropped.
  const hasRole = (role: "owner" | "admin" | "member") =>
    hasOrgRole(orgSlug, role).catch(degradeTo(`report permalink: hasOrgRole(${role})`, false));
  // Owner-only passport controls (P4): editable only for a non-public org-owned repo by an owner.
  const canEditPassport = Boolean(passport) && orgSlug !== PUBLIC_ORG && (await hasRole("owner"));
  // The .ai/passport.json PR route accepts ADMINS (unlike the owner-only overrides), so its button is
  // gated separately: an admin who is not an owner gets the PR affordance and not the override form.
  const canFilePassportPr = canEditPassport || (Boolean(passport) && orgSlug !== PUBLIC_ORG && (await hasRole("admin")));
  // The .ai/ foundation install-PR button: any org MEMBER of a non-public repo (mirrors the route's
  // requireOrgAccess — member-level, unlike the owner-only passport controls).
  const canInstallFoundation = orgSlug !== PUBLIC_ORG && (await hasRole("member"));

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
        serverRecs={recs.items}
        serverLifts={recs.lifts}
        installFoundation={canInstallFoundation}
        lastSeenHead={headHint}
        freshnessWindowMs={scanMaxCacheAgeMs()}
      />
      <PermalinkPanels
        passport={passport}
        repoRef={repoRef}
        canEdit={canEditPassport}
        canFilePr={canFilePassportPr}
        skillHistory={skillHistory}
      />
    </ReportErrorBoundary>
  );
}

/** One server read whose failure must stay distinguishable: a THROW is reported and resolves
 *  `undefined` (not resolved), never the store's own empty answer. */
async function readOrUnresolved<T>(read: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    reportFailedRead(`report permalink: ${read}`, err);
    return undefined;
  }
}

/** The head last seen for this repo (the freshness drift clause). Wrapped, not `.catch()`-ed inline:
 *  a throw while BUILDING the Promise.all array escapes it; null is the no-claim answer either way. */
async function readLastSeenHead(owner: string, name: string, orgSlug: string): Promise<string | null> {
  try {
    return (await getHeadHint(owner, name, { orgSlug }))?.headSha ?? null;
  } catch (err) {
    reportDegradedRead("report permalink: getHeadHint", err);
    return null;
  }
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
  const gated = authGateEnabled() || isAuthConfigured();
  if (gated && !(await resolveViewerLogin().catch(degradeTo("report permalink: resolveViewerLogin", null)))) return null;
  let history: RepositoryHistory | null;
  try {
    // strict: an unreachable DB throws here (→ null below) instead of resolving the empty history.
    history = await getRepositoryHistory(owner, name, { orgSlug, strict: true });
  } catch (err) {
    // A thrown read is NOT "no history": null leaves ReportView's client fetch (and its
    // "Couldn't load history" door) in charge, as the docstring above promises.
    reportFailedRead("report permalink: getRepositoryHistory", err);
    return null;
  }
  return history ?? { repo: { owner, name, fullName: `${owner}/${name}` }, scans: [] };
}

/**
 * The latest scan's persisted recommendations, server-side — the same `getLatestRecommendations` read
 * GET /api/recommendations serves. Its org resolution deliberately mirrors that route's (owner-as-slug
 * when readable, else the public org) rather than reusing the report's `orgSlug`: the report resolves
 * via the dormant-session `readableOrgForOwner`, which under-permissions a private-org member and would
 * hand back an empty list where the client fetch found the real tracker.
 *
 * It also reads the org's measured lift map in the same pass (`ExpectedLiftBasis` and the measured-sort
 * toggle are unreachable in-app without it). `items: undefined` = a FAILED read (the access check or
 * the rows): ReportView then fetches for itself, because `[]` is a real answer it would never refetch.
 */
async function readReportRecommendations(owner: string, name: string) {
  const ownerOrg = owner.toLowerCase();
  let orgSlug: string;
  try {
    orgSlug = (await canReadOrg(ownerOrg)) ? ownerOrg : PUBLIC_ORG;
  } catch (err) {
    // A thrown access check is not "may not read": answering under the public org instead would serve
    // an empty roadmap where the client fetch finds the real tracker.
    reportFailedRead("report permalink: canReadOrg", err);
    return { items: undefined, lifts: undefined } as const;
  }
  const [items, lifts] = await Promise.all([
    // No persisted scan (null) is the answer "no recommendations" ([]); a THROWN read stays undefined.
    readOrUnresolved("getLatestRecommendations", async () => (await getLatestRecommendations(owner, name, { orgSlug, strict: true }))?.items ?? []),
    // The org's measured lift map, read under the SAME org the rows were read under — the ledger is
    // tenant-local, so resolving it off the report's own (more conservative) orgSlug could pair one
    // org's rows with another's measurements. A failed read degrades to no map, which is exactly the
    // pre-existing rendering: no basis clause, no measured-sort toggle, no reordering (G4).
    getOrgExpectedLifts(orgSlug).catch(degradeTo("report permalink: getOrgExpectedLifts", EMPTY_LIFTS)),
  ]);
  return { items, lifts };
}
