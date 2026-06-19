import { SiteFooter, SiteHeader } from "@/components/Brand";
import { SignInNotice } from "@/components/SignInNotice";
import { OrgNav } from "@/components/org/OrgNav";
import { OrgScanButton } from "@/components/org/OrgScanButton";
import { CreditsControl } from "@/components/org/CreditsControl";
import { AlertsControl } from "@/components/org/AlertsControl";
import { OrgEmpty } from "@/components/org/ui";
import { ensureOwnerMembership, getCreditState, getMembershipRole, getOrgRollup, isDbConfigured, isDbUnavailableError } from "@/lib/db";
import { getSessionState, isAuthConfigured } from "@/lib/auth";
import { authBypassEnabled, authGateEnabled, getViewer } from "@/lib/access";
import { canReadOrg } from "@/lib/authz";
import { creditPacks, polarEnabled } from "@/lib/polar";
import { levelForScore } from "@/lib/maturity/model";
import { scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-7xl px-5 py-8">{children}</main>
      <SiteFooter />
    </>
  );
}

/**
 * Org shell: SiteHeader + a persistent org header (name · maturity chip · scan) + the tab bar,
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

  // Rollup + credit state are independent (both keyed on the slug alone), so fetch them together —
  // this shell wraps EVERY org tab, so its waterfall taxes every dashboard view. Prepaid scan-credit
  // state feeds the header chip (null for the shared public org, which is free).
  // The "Org demo" header link points here whenever DATABASE_URL is set — but a set-yet-unreachable
  // DB (local Postgres not running, or a prod outage) makes these reads throw a
  // PrismaClientInitializationError that, unguarded, crashed the whole dashboard with a raw stack.
  // Surface the same calm empty-state the DB-less branch above uses, so the demo degrades instead of
  // 500-ing. A query error against a LIVE DB still propagates (it's a real bug, not "DB down").
  // The login whose org role we resolve + (under the dev bypass) persist below: the custom-OAuth
  // session wins; otherwise, under ASCENT_AUTH_BYPASS, the synthetic "developer" viewer.
  const bypassViewer = authBypassEnabled() ? await getViewer() : null;
  const roleLogin = session?.login ?? bypassViewer?.login ?? null;

  let rollup: Awaited<ReturnType<typeof getOrgRollup>>;
  let credit: Awaited<ReturnType<typeof getCreditState>> | null;
  let myRole: Awaited<ReturnType<typeof getMembershipRole>> | null;
  try {
    [rollup, credit, myRole] = await Promise.all([
      getOrgRollup(slug),
      slug === "public" ? Promise.resolve(null) : getCreditState(slug),
      // MEM-6: the viewer's own role, so every member can see their access level (not just owners who
      // can open the Members tab). Null for the public org / non-members.
      roleLogin && slug !== "public" ? getMembershipRole(slug, roleLogin).catch(() => null) : Promise.resolve(null),
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
  if (!rollup || rollup.repoCount === 0) {
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

  const watched = rollup.repos.filter((r) => r.watched).length;
  const level = levelForScore(rollup.avgOverall);

  const grantsEnabled =
    process.env.ASCENT_ALLOW_CREDIT_GRANTS === "1" || process.env.ASCENT_ALLOW_CREDIT_GRANTS === "true";
  // Polar credit purchase (CRED-1): show the "Buy credits" packs when billing is configured. The packs
  // are plain serializable data; the SDK stays server-side (CreditsControl declares its own Pack type).
  const buyEnabled = polarEnabled();
  const packs = buyEnabled ? creditPacks() : [];

  return (
    <Frame>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Org maturity</div>
            <h1 className="mt-0.5 text-2xl font-bold text-white">{slug}</h1>
          </div>
          <span className="rounded-md border border-slate-700 px-2.5 py-1 font-mono text-sm" style={{ color: scoreHex(rollup.avgOverall) }}>
            {level.id} · {rollup.avgOverall}
          </span>
          {myRole && (
            <span
              className="rounded-md border border-accent/40 bg-accent/5 px-2.5 py-1 font-mono text-sm uppercase tracking-widest text-accent"
              title="Your role in this organization"
            >
              {myRole}
            </span>
          )}
          <span className="font-mono text-sm text-slate-500">
            {rollup.scannedCount}/{rollup.repoCount} scanned · {watched} watched
          </span>
        </div>
        <div className="flex items-center gap-2">
          {slug !== "public" && <AlertsControl org={slug} />}
          {credit && (
            <CreditsControl
              org={slug}
              initialBalance={credit.balance}
              unlimited={credit.unlimited}
              grantsEnabled={grantsEnabled}
              buyEnabled={buyEnabled}
              packs={packs}
            />
          )}
          <OrgScanButton org={slug} watchedCount={watched} />
        </div>
      </div>
      <div className="mt-6 lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-8">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <OrgNav slug={slug} />
        </aside>
        <div className="mt-4 animate-fade-up lg:mt-0">{children}</div>
      </div>
    </Frame>
  );
}
