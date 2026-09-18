// The theater page's access gates — OrgShell's, in its order, with its outcomes (see page.tsx for why
// the theater repeats them rather than inheriting them). A separate module because a Next page file
// may export only the page and its config.

import { SiteHeader } from "@/components/Brand";
import { SignInNotice } from "@/components/SignInNotice";
import { OrgEmpty } from "@/components/org/shared/ui";
import { getSessionState, isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, getViewer } from "@/lib/access";
import { canReadOrg } from "@/lib/authz";
import { isDbConfigured } from "@/lib/db";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-7xl px-5 py-8">
        {children}
      </main>
    </>
  );
}

/** The org shell's gates, in its order, with its outcomes. Null = the viewer may watch this org. */
export async function theaterGate(slug: string): Promise<React.ReactNode | null> {
  if (!isDbConfigured()) {
    return (
      <Frame>
        <OrgEmpty title="Theater needs a database" body="The runner's pulse reads stored runs: set DATABASE_URL (local Postgres or Aurora DSQL)." />
      </Frame>
    );
  }
  const next = `/theater/${slug}`;
  if (authGateEnabled() && !(await getViewer())) {
    return (
      <Frame>
        <SignInNotice next={next} provider="supabase" />
      </Frame>
    );
  }
  const { session, status } = await getSessionState();
  if (isAuthConfigured() && !session) {
    return (
      <Frame>
        <SignInNotice next={next} expired={status === "expired"} />
      </Frame>
    );
  }
  if (!(await canReadOrg(slug))) {
    const body = isAuthConfigured()
      ? "This organization's dashboard is private to members who've installed the Ascent GitHub App on it. If you just installed it, re-sync your GitHub access on the onboarding page."
      : "Per-organization dashboards require the GitHub App and authentication to be configured on this deployment. Only the shared public dashboard is available here.";
    return (
      <Frame>
        <OrgEmpty title={`No access to ${slug}`} body={body} href="/onboarding" cta="Go to onboarding" />
      </Frame>
    );
  }
  return null;
}
