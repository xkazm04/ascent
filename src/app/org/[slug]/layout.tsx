import { SiteFooter, SiteHeader } from "@/components/Brand";
import { SignInNotice } from "@/components/SignInNotice";
import { OrgNav } from "@/components/org/OrgNav";
import { OrgScanButton } from "@/components/org/OrgScanButton";
import { CreditsControl } from "@/components/org/CreditsControl";
import { OrgEmpty } from "@/components/org/ui";
import { getCreditState, getOrgRollup, isDbConfigured } from "@/lib/db";
import { getSessionState, isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, getViewer } from "@/lib/access";
import { canReadOrg } from "@/lib/authz";
import { levelForScore } from "@/lib/maturity/model";
import { scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl px-5 py-8">{children}</main>
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
  const [rollup, credit] = await Promise.all([
    getOrgRollup(slug),
    slug === "public" ? Promise.resolve(null) : getCreditState(slug),
  ]);
  if (!rollup || rollup.repoCount === 0) {
    return (
      <Frame>
        <OrgEmpty title={`No data for ${slug}`} body="Watch some repositories on /connect and run a scan, then this dashboard fills in." href="/connect" cta="Go to Connect" />
      </Frame>
    );
  }

  const watched = rollup.repos.filter((r) => r.watched).length;
  const level = levelForScore(rollup.avgOverall);

  const grantsEnabled =
    process.env.ASCENT_ALLOW_CREDIT_GRANTS === "1" || process.env.ASCENT_ALLOW_CREDIT_GRANTS === "true";

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
          <span className="font-mono text-sm text-slate-500">
            {rollup.scannedCount}/{rollup.repoCount} scanned · {watched} watched
          </span>
        </div>
        <div className="flex items-center gap-2">
          {credit && (
            <CreditsControl
              org={slug}
              initialBalance={credit.balance}
              unlimited={credit.unlimited}
              grantsEnabled={grantsEnabled}
            />
          )}
          <OrgScanButton org={slug} watchedCount={watched} />
        </div>
      </div>
      <OrgNav slug={slug} />
      <div className="mt-6 animate-fade-up">{children}</div>
    </Frame>
  );
}
