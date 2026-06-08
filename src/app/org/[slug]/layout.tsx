import { SiteFooter, SiteHeader } from "@/components/Brand";
import { SignInNotice } from "@/components/SignInNotice";
import { OrgNav } from "@/components/org/OrgNav";
import { OrgScanButton } from "@/components/org/OrgScanButton";
import { OrgEmpty } from "@/components/org/ui";
import { getOrgRollup, isDbConfigured } from "@/lib/db";
import { getSessionState, isAuthConfigured, PUBLIC_ORG } from "@/lib/auth";
import { sessionOwnsOrg } from "@/lib/authz";
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
  const { session, status } = await getSessionState();
  if (isAuthConfigured() && !session) {
    return (
      <Frame>
        <SignInNotice next={`/org/${slug}`} expired={status === "expired"} />
      </Frame>
    );
  }

  // Authorize the TENANT, not just authentication. Without this, any signed-in user could read
  // another org's private fleet (repo names, maturity scores, contributor logins/commit counts)
  // simply by visiting its slug — a cross-tenant IDOR. This mirrors the write-path gate
  // (requireOrgAccess on /api/org/scan|watch) and readableOrgForOwner: the shared PUBLIC_ORG is
  // open to anyone, any other slug requires a session whose installations include it. Checked
  // before getOrgRollup so a non-member can't even distinguish "exists with data" from "no data".
  // (Auth-off deploys stay open — consistent with the rest of the authz model; see W1-4 follow-up.)
  if (isAuthConfigured() && slug.toLowerCase() !== PUBLIC_ORG && !(await sessionOwnsOrg(slug))) {
    return (
      <Frame>
        <OrgEmpty
          title={`No access to ${slug}`}
          body="This organization's dashboard is private to members who've installed the Ascent GitHub App on it. If you just installed it, re-sync your GitHub access on Connect."
          href="/connect"
          cta="Go to Connect"
        />
      </Frame>
    );
  }

  const rollup = await getOrgRollup(slug);
  if (!rollup || rollup.repoCount === 0) {
    return (
      <Frame>
        <OrgEmpty title={`No data for ${slug}`} body="Watch some repositories on /connect and run a scan, then this dashboard fills in." href="/connect" cta="Go to Connect" />
      </Frame>
    );
  }

  const watched = rollup.repos.filter((r) => r.watched).length;
  const level = levelForScore(rollup.avgOverall);

  return (
    <Frame>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">Org maturity</div>
            <h1 className="mt-0.5 text-2xl font-bold text-white">{slug}</h1>
          </div>
          <span className="rounded-md border border-slate-700 px-2.5 py-1 font-mono text-xs" style={{ color: scoreHex(rollup.avgOverall) }}>
            {level.id} · {rollup.avgOverall}
          </span>
          <span className="font-mono text-[11px] text-slate-500">
            {rollup.scannedCount}/{rollup.repoCount} scanned · {watched} watched
          </span>
        </div>
        <OrgScanButton org={slug} watchedCount={watched} />
      </div>
      <OrgNav slug={slug} />
      <div className="mt-6 animate-fade-up">{children}</div>
    </Frame>
  );
}
