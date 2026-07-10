import { OrgHeader, SiteHeader } from "@/components/Brand";
import { SignInNotice } from "@/components/SignInNotice";
import { OrgNav } from "@/components/org/shared/OrgNav";
import { OrgScanButton } from "@/components/org/shared/OrgScanButton";
import { CreditsControl } from "@/components/org/shared/CreditsControl";
import { AlertsControl } from "@/components/org/shared/AlertsControl";
import { OrgEmpty } from "@/components/org/shared/ui";
import { OnboardingLab } from "@/components/onboarding/tour/OnboardingLab";
import { DEMO_ORG_SLUG } from "@/lib/site";
import { countMeteredScansThisMonth, ensureOwnerMembership, getCreditState, getMembershipRole, getOrgHeaderSummary, isDbConfigured, isDbUnavailableError } from "@/lib/db";
import { getSessionState, isAuthConfigured } from "@/lib/auth";
import { authBypassEnabled, authGateEnabled, getViewer } from "@/lib/access";
import { canReadOrg } from "@/lib/authz";
import { creditPacks, polarEnabled } from "@/lib/polar";
import { scanAllowance } from "@/lib/plans";
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
  // The login whose org role we resolve + (under the dev bypass) persist below: the custom-OAuth
  // session wins; otherwise, under ASCENT_AUTH_BYPASS, the synthetic "developer" viewer.
  const bypassViewer = authBypassEnabled() ? await getViewer() : null;
  const roleLogin = session?.login ?? bypassViewer?.login ?? null;

  let summary: Awaited<ReturnType<typeof getOrgHeaderSummary>>;
  let credit: Awaited<ReturnType<typeof getCreditState>> | null;
  let myRole: Awaited<ReturnType<typeof getMembershipRole>> | null;
  let usageThisMonth: number;
  try {
    [summary, credit, myRole, usageThisMonth] = await Promise.all([
      getOrgHeaderSummary(slug),
      slug === "public" ? Promise.resolve(null) : getCreditState(slug),
      // MEM-6: the viewer's own role, so every member can see their access level (not just owners who
      // can open the Members tab). Null for the public org / non-members.
      roleLogin && slug !== "public" ? getMembershipRole(slug, roleLogin).catch(() => null) : Promise.resolve(null),
      // Month-to-date metered scans, so the credits chip knows the plan's free allowance still covers
      // scans at balance 0 (and doesn't falsely warn "paused"). Free for the public org.
      slug === "public" ? Promise.resolve(0) : countMeteredScansThisMonth(slug).catch(() => 0),
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
  if (!summary || summary.repoCount === 0) {
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
  // deployment; gated on a populated org so a bogus-slug visit never materializes an empty org. (myRole
  // above is null on the very first visit and fills in once the row exists.)
  if (bypassViewer && slug !== "public") {
    await ensureOwnerMembership(slug, bypassViewer.login, bypassViewer.name).catch(() => {});
  }

  const watched = summary.watchedCount;
  const level = levelForScore(summary.avgOverall);

  const grantsEnabled =
    process.env.ASCENT_ALLOW_CREDIT_GRANTS === "1" || process.env.ASCENT_ALLOW_CREDIT_GRANTS === "true";
  // Polar credit purchase (CRED-1): show the "Buy credits" packs when billing is configured. The packs
  // are plain serializable data; the SDK stays server-side (CreditsControl declares its own Pack type).
  const buyEnabled = polarEnabled();
  const packs = buyEnabled ? creditPacks() : [];
  // Free metered scans left in the plan's monthly allowance, so the credits chip doesn't say "out of
  // credits / paused" at balance 0 while the allowance still covers scans. null allowance = unlimited
  // (Enterprise) — the chip shows "Unlimited" anyway, so 0 here is harmless.
  const planAllowance = credit ? scanAllowance(credit.plan) : null;
  const allowanceRemaining = planAllowance == null ? 0 : Math.max(0, planAllowance - usageThisMonth);

  // The org's persistent actions (alerts · credits · scan), folded into the OrgHeader's right cluster.
  // The old in-content "scanned · watched" line and the plan-tier chip are intentionally dropped — the
  // header carries only identity + the live actions.
  const actions = (
    <>
      {slug !== "public" && <AlertsControl org={slug} />}
      {credit && (
        <CreditsControl
          org={slug}
          initialBalance={credit.balance}
          unlimited={credit.unlimited}
          grantsEnabled={grantsEnabled}
          buyEnabled={buyEnabled}
          packs={packs}
          allowanceRemaining={allowanceRemaining}
        />
      )}
      <div data-tour="scan-scope">
        <OrgScanButton org={slug} watchedCount={watched} />
      </div>
    </>
  );

  return (
    <>
      <OrgHeader slug={slug} levelId={level.id} score={summary.avgOverall} role={myRole} actions={actions} />
      <main id="main" className="mx-auto w-full max-w-7xl px-5 py-8">
        <div className="lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-8">
          <aside data-tour="modules-nav" className="lg:sticky lg:top-20 lg:self-start">
            <OrgNav slug={slug} />
          </aside>
          <div className="animate-fade-up">{children}</div>
        </div>
      </main>
      {/* PROTOTYPE: temporary onboarding-tour A/B harness, scoped to the curated demo org. Persisting it
          in the layout (not a page) lets the tour survive sub-page navigation and re-anchor on redirect. */}
      {slug.toLowerCase() === DEMO_ORG_SLUG && <OnboardingLab slug={slug} />}
    </>
  );
}
