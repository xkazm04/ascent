import { ORG_SHELL, OrgHeader, SiteHeader } from "@/components/Brand";
import { SignInNotice } from "@/components/SignInNotice";
import { OrgTabNav } from "@/components/org/shell/OrgTabNav";
import { OrgShellActions } from "@/components/org/shell/OrgShellActions";
import { OrgFirstScanEmpty } from "@/components/org/shell/OrgFirstScanEmpty";
import { resolveOrgShellState } from "./orgShellGate";
import { OrgEmpty } from "@/components/org/shared/ui";
import { TourChecklist } from "@/components/onboarding/tour/TourChecklist";
import { countMeteredScansThisMonth, ensureOwnerMembership, getCreditState, getMembershipRole, getOrgHeaderSummary, isDbConfigured, isDbUnavailableError } from "@/lib/db";
import { getNavCounts } from "@/lib/org/nav-counts";
import { getSessionState, isAuthConfigured } from "@/lib/auth";
import { authBypassEnabled, authGateEnabled, getViewer, resolveViewerLogin } from "@/lib/access";
import { canReadOrg } from "@/lib/authz";
import { levelForScore } from "@/lib/maturity/model";

export const dynamic = "force-dynamic";

// Frame wraps the pre-dashboard states (no DB, sign-in wall, no access, no data): the marketing
// SiteHeader over a plain main. NO SiteFooter — the footer belongs to the marketing shell only, never
// the org dashboard. The populated dashboard (below) swaps SiteHeader for the org-scoped OrgHeader.
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-7xl px-5 py-8">{children}</main>
    </>
  );
}

/**
 * Org shell: the org-scoped OrgHeader (name · maturity · role + alerts/credits/scan) + the tab bar,
 * wrapping every org sub-page. Centralizes the DB/auth/empty guards so the tabs only appear
 * once there's a real org to browse; sub-pages assume valid data.
 */
export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!isDbConfigured()) {
    return (
      <Frame>
        <OrgEmpty title="Dashboard needs a database" body="Org rollups read stored scans — set DATABASE_URL (local Postgres or Aurora DSQL)." />
      </Frame>
    );
  }
  // Supabase login wall (layered on the dormant custom OAuth): when enforced, require a signed-in
  // viewer before reading any org data. Any signed-in viewer may view any org (simple-wall semantics);
  // canReadOrg below then returns true for them.
  if (authGateEnabled() && !(await getViewer())) {
    return (
      <Frame>
        <SignInNotice next={`/org/${slug}`} provider="supabase" />
      </Frame>
    );
  }

  const { session, status } = await getSessionState();
  if (isAuthConfigured() && !session) {
    return (
      <Frame>
        <SignInNotice next={`/org/${slug}`} expired={status === "expired"} />
      </Frame>
    );
  }

  // Authorize the TENANT, not just authentication, before reading any org data. Without this:
  //  - any signed-in user could read another org's private fleet (repo names, maturity scores,
  //    contributor logins/commit counts) by visiting its slug — a cross-tenant IDOR; and
  //  - a DB-on but auth-off deployment (e.g. AUTH_SECRET dropped) would serve every org's
  //    private dashboard to anonymous visitors.
  // canReadOrg encodes both: PUBLIC_ORG is open; any other slug needs a session that owns it
  // (auth-on) and is refused entirely when auth is off. Mirrors the write-path requireOrgAccess
  // (/api/org/scan|watch) and readableOrgForOwner. Checked before getOrgRollup so a non-member
  // can't even distinguish "exists with data" from "no data yet".
  if (!(await canReadOrg(slug))) {
    const body = isAuthConfigured()
      ? "This organization's dashboard is private to members who've installed the Ascent GitHub App on it. If you just installed it, re-sync your GitHub access on Connect."
      : "Per-organization dashboards require the GitHub App and authentication to be configured on this deployment. Only the shared public dashboard is available here.";
    return (
      <Frame>
        <OrgEmpty title={`No access to ${slug}`} body={body} href="/connect" cta="Go to Connect" />
      </Frame>
    );
  }

  // A lightweight header summary + credit state are independent (both keyed on the slug alone), so fetch
  // them together — this shell wraps EVERY org tab, so its waterfall taxes every dashboard view. The
  // shell consumes only repo/scan/watch counts + avg maturity, so it uses getOrgHeaderSummary (one cheap
  // query) instead of the full getOrgRollup (which each page that needs trend/forecast/postures runs
  // itself). Prepaid scan-credit state feeds the header chip (null for the shared public org, which is free).
  // The "Org demo" header link points here whenever DATABASE_URL is set — but a set-yet-unreachable
  // DB (local Postgres not running, or a prod outage) makes these reads throw a
  // PrismaClientInitializationError that, unguarded, crashed the whole dashboard with a raw stack.
  // Surface the same calm empty-state the DB-less branch above uses, so the demo degrades instead of
  // 500-ing. A query error against a LIVE DB still propagates (it's a real bug, not "DB down").
  // The login whose org role we resolve: resolveViewerLogin covers BOTH auth stacks (custom-OAuth
  // session wins, then the Supabase/bypass viewer). It used to be `session?.login ?? bypassViewer?.
  // login`, which missed real Supabase viewers entirely — their Membership row is their only standing,
  // and W6b's first-scan gate below keys on exactly that role. bypassViewer stays bypass-only: it
  // additionally gates the dev-only owner-seeding seam further down.
  const bypassViewer = authBypassEnabled() ? await getViewer() : null;
  const roleLogin = (await resolveViewerLogin()) ?? null;

  let summary: Awaited<ReturnType<typeof getOrgHeaderSummary>>;
  let credit: Awaited<ReturnType<typeof getCreditState>> | null;
  let myRole: Awaited<ReturnType<typeof getMembershipRole>> | null;
  let usageThisMonth: number;
  let navCounts: Awaited<ReturnType<typeof getNavCounts>>;
  try {
    [summary, credit, myRole, usageThisMonth, navCounts] = await Promise.all([
      getOrgHeaderSummary(slug),
      slug === "public" ? Promise.resolve(null) : getCreditState(slug),
      // MEM-6: the viewer's own role, so every member can see their access level (not just owners who
      // can open the Members tab). Null for the public org / non-members.
      roleLogin && slug !== "public" ? getMembershipRole(slug, roleLogin).catch(() => null) : Promise.resolve(null),
      // Month-to-date metered scans, so the credits chip knows the plan's free allowance still covers
      // scans at balance 0 (and doesn't falsely warn "paused"). Free for the public org.
      slug === "public" ? Promise.resolve(0) : countMeteredScansThisMonth(slug).catch(() => 0),
      // Rail badges (items awaiting a decision). Non-critical chrome, so a failure degrades to an
      // unbadged rail rather than 500-ing the shell — same posture as myRole/usageThisMonth above.
      getNavCounts(slug).catch(() => null),
    ]);
  } catch (err) {
    if (isDbUnavailableError(err)) {
      return (
        <Frame>
          <OrgEmpty
            title="Dashboard temporarily unavailable"
            body="Couldn't reach the database that stores org rollups. Check that the database server is running, then reload."
          />
        </Frame>
      );
    }
    throw err;
  }
  // The empty-org gate, resolved by the pure orgShellGate so tests can pin it:
  //  - "wall"       — no org row at all, or a zero-repo fleet org viewed by a NON-member: the old
  //                   "No data" dead end, unchanged (a non-member still can't distinguish "exists,
  //                   empty" from "no data yet").
  //  - "first-scan" — W6b: a MEMBER's zero-repo fleet org renders the FULL shell (header + rail +
  //                   tabs) with an onboarding-oriented empty state in the content slot, so the
  //                   product is visible before the first scan instead of walled off behind it.
  //  - "shell"      — populated org, or a PERSONAL workspace at any repo count (its overview's
  //                   add-repo form IS the empty state; pointing an individual at /connect, the
  //                   GitHub-App install flow, would be wrong).
  const isMember = Boolean(myRole) || Boolean(bypassViewer);
  const shellState = resolveOrgShellState({
    summary: summary ? { repoCount: summary.repoCount, kind: summary.kind } : null,
    isMember,
  });
  // `!summary` is redundant with "wall" (the gate returns "wall" for a null summary) but narrows the
  // type for everything below without a non-null assertion.
  if (shellState === "wall" || !summary) {
    return (
      <Frame>
        <OrgEmpty title={`No data for ${slug}`} body="Watch some repositories on /connect and run a scan, then this dashboard fills in." href="/connect" cta="Go to Connect" />
      </Frame>
    );
  }

  // Dev-only profile seam: under ASCENT_AUTH_BYPASS there's no real session, so the synthetic
  // "developer" viewer otherwise has no persisted profile/membership and every org-role gate is
  // blanket-open. Persist a real owner Membership (idempotent, best-effort) on this populated org so
  // local runs (UAT/demo) operate on a genuine profile in the production-schema PGlite DB — the
  // Members tab, the role chip and RBAC reads then reflect a real row instead of a hollow open gate.
  // authBypassEnabled() is hard-disabled in production, so this can never seed a ghost owner on a real
  // deployment; gated on an EXISTING org (summary is non-null past the wall — populated, or W6b's
  // member zero-repo state) so a bogus-slug visit never materializes an org that isn't there. (myRole
  // above is null on the very first visit and fills in once the row exists.)
  if (bypassViewer && slug !== "public") {
    await ensureOwnerMembership(slug, bypassViewer.login, bypassViewer.name).catch(() => {});
  }

  const level = levelForScore(summary.avgOverall);

  // The header's right cluster (alerts · credits · scan), including every env/plan decision behind
  // it — see OrgShellActions.
  const actions = (
    <OrgShellActions
      slug={slug}
      kind={summary.kind}
      credit={credit}
      watchedCount={summary.watchedCount}
      usageThisMonth={usageThisMonth}
    />
  );

  return (
    <>
      <OrgHeader slug={slug} levelId={level.id} score={summary.avgOverall} role={myRole} actions={actions} />
      {/* tabIndex={-1} makes <main> a programmatic focus target: it is already the skip-link
          destination, and OrgTabNav moves focus here on a real tab switch so an AT user isn't left
          with a silently swapped page. Without it, .focus() is a no-op on a non-interactive element. */}
      <main id="main" tabIndex={-1} className={`${ORG_SHELL} py-8 focus:outline-none`}>
        <div className="lg:grid lg:grid-cols-[264px_minmax(0,1fr)] lg:gap-6">
          <aside data-tour="modules-nav" className="lg:sticky lg:top-20 lg:self-start">
            <OrgTabNav slug={slug} counts={navCounts ?? undefined} kind={summary.kind} />
          </aside>
          {/* W6b: a member's zero-repo fleet org gets the first-scan empty state in the content slot
              (every tab would be empty anyway); the moment the first import lands, repoCount > 0 and
              the real tab content takes over. */}
          <div className="animate-fade-up">{shellState === "first-scan" ? <OrgFirstScanEmpty slug={slug} /> : children}</div>
        </div>
      </main>
      {/* Guided onboarding drawer for ANY org dashboard — it used to mount only on the curated demo org,
          so every real customer who finished onboarding and clicked "View dashboard" never saw the one
          surface that teaches this dashboard. It opens closed (just the pull tab) and the engine skips
          steps whose anchor this org doesn't render, so a thin/personal org degrades instead of pointing
          at nothing. Mounted in the layout (not a page) so the tour survives sub-page navigation and
          re-anchors after each redirect. Skipped on the first-scan empty state — there is nothing to
          teach until data exists, and every anchor it would point at is absent. */}
      {shellState !== "first-scan" && <TourChecklist slug={slug} />}
    </>
  );
}
