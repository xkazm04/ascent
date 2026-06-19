import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { SignInNotice } from "@/components/SignInNotice";
import { GitHubSignInButton } from "@/components/GitHubSignInButton";
import { InstallationRepos } from "@/components/connect/InstallationRepos";
import { ConnectPrivacyNotice } from "@/components/connect/PrivacyNotice";
import { ConnectDiscovered } from "@/components/connect/ConnectDiscovered";
import { resolveInstallView } from "./installRouting";
import { OnboardingChecklist } from "@/components/onboarding/OnboardingChecklist";
import { appConfigureUrl, appInstallUrl, isAppConfigured } from "@/lib/github/app";
import { getSessionState, isAuthConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ERROR_COPY: Record<string, string> = {
  not_configured: "The GitHub App isn't configured on this deployment.",
  missing_installation: "GitHub didn't return an installation id. Please try installing again.",
  setup_failed: "We couldn't finish setting up the installation. Please try again.",
  oauth: "Sign-in could not be verified. Please try again.",
  oauth_failed: "Sign-in failed. Please try again.",
  denied: "Sign-in was cancelled on GitHub. Granting access lets Ascent scan your repositories — sign in again when you're ready.",
  csrf: "Your sign-in attempt expired or didn't match this browser session. Please try signing in again.",
  revoke: "We couldn't sign out your other sessions. Please try again.",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-5 py-10">{children}</main>
      <SiteFooter />
    </>
  );
}

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; installation_id?: string; error?: string; resynced?: string; revoked?: string }>;
}) {
  const { org, installation_id, error, resynced, revoked } = await searchParams;
  const installUrl = appInstallUrl();
  const { session, status } = await getSessionState();

  const header = (
    <>
      <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Connect GitHub</div>
      <h1 className="mt-1 text-3xl font-bold text-white">Scan your private repositories</h1>
      <p className="mt-2 max-w-2xl text-slate-400">
        Install the Ascent GitHub App on an organization or account. Inference runs against
        your repositories using a short-lived installation token — Ascent stores only the
        derived scores and evidence, never your source.
      </p>
      <ConnectPrivacyNotice />
      {error && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-danger/30 bg-danger/5 p-4 text-base text-danger-soft"
        >
          {ERROR_COPY[error] ?? "Something went wrong."}
        </div>
      )}
    </>
  );

  // App not configured at all — nothing to do here.
  if (!isAppConfigured()) {
    return (
      <Shell>
        <div className="animate-fade-up">
          {header}
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="font-semibold text-white">GitHub App not configured</h2>
            <p className="mt-2 text-base text-slate-400">
              Set <code className="font-mono text-slate-300">GITHUB_APP_ID</code> and{" "}
              <code className="font-mono text-slate-300">GITHUB_APP_PRIVATE_KEY</code> (see{" "}
              <span className="font-mono text-slate-300">docs/GITHUB_APP.md</span>) to enable
              private-repo scanning. Public scans work without it.
            </p>
            <Link href="/" className="mt-4 inline-block rounded-lg border border-slate-700 px-4 py-2 text-base text-slate-300 hover:border-accent hover:text-white">
              ← Back to public scans
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  // Auth configured but not signed in → require sign-in.
  if (isAuthConfigured() && !session) {
    return (
      <Shell>
        <div className="animate-fade-up">
          {header}
          <SignInNotice next="/connect" expired={status === "expired"} />
        </div>
      </Shell>
    );
  }

  // Build the installations to display: the signed-in user's (from the session). A just-installed
  // org arrives via the setup redirect (?org=&installation_id=) but isn't baked into the session
  // until a re-sync. /api/app/repos now authorizes against the session, so listing a
  // not-yet-in-session org would 403 — when auth is on we surface a one-click re-sync for it
  // instead of a panel that can't load. Auth-off has no session to re-sync, so the query-carried
  // org renders directly (the API gate is open in that mode).
  const { installs, pendingInstall } = resolveInstallView({
    session,
    org,
    installationId: installation_id,
    authConfigured: isAuthConfigured(),
  });

  const installCount = session?.installations.length ?? 0;
  // Orgs auto-discovered at login (see src/lib/github/discover.ts): the most-active org we
  // pre-seeded a watchlist for (a ready dashboard), plus not-yet-installed orgs to nudge.
  const seededOrg = session?.seededOrg;
  const suggestedOrgs = session?.suggestedOrgs ?? [];

  return (
    <Shell>
      <div className="animate-fade-up">
        {header}
        {/* Funnel progress — mirrors the onboarding checklist so the two first-run halves feel like
            one flow. Install is derived from the session; the later steps signpost the path. */}
        <div className="mt-6">
          <OnboardingChecklist
            steps={[
              {
                label: "Install the Ascent GitHub App",
                done: installs.length > 0 || Boolean(pendingInstall),
                href: installs.length === 0 && !pendingInstall ? installUrl ?? undefined : undefined,
                hint: "Grant read-only access to the repos you want scanned",
              },
              { label: "Pick repositories to watch", done: false, hint: "Choose which repos Ascent should scan" },
              { label: "Run your first scan", done: false, hint: "Open a repo's report to see its maturity" },
            ]}
          />
        </div>
        {resynced && (
          <div
            role="status"
            className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-base text-emerald-300"
          >
            GitHub access re-synced — {installCount} installation{installCount === 1 ? "" : "s"} now available.
          </div>
        )}
        {revoked && (
          <div
            role="status"
            className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-base text-emerald-300"
          >
            {revoked === "others"
              ? "Signed out of all other sessions — this browser stays signed in."
              : "Your session was refreshed, but other sessions can't be centrally revoked without a database."}
          </div>
        )}
        {/* Login-time org auto-discovery: a ready-to-explore seeded dashboard + orgs to connect. */}
        <ConnectDiscovered seededOrg={seededOrg} suggestedOrgs={suggestedOrgs} />
        {/* Self-serve refresh: re-fetch installations and re-issue the session without waiting
            out the 7-day cookie, so a repo/org just added on GitHub shows up immediately. */}
        {session && (
          <div className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <GitHubSignInButton
                variant="nav"
                resync
                next="/connect"
                label="Re-sync access"
                pendingLabel="Re-syncing…"
              />
              <p className="text-sm text-slate-500">
                Added a repo or org on GitHub but don&apos;t see it here? Re-sync to refresh your
                installations without signing out.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <form action="/api/auth/revoke-sessions" method="post" className="contents">
                <button
                  type="submit"
                  className="focus-ring rounded-md border border-slate-700 px-3 py-1.5 font-mono text-sm uppercase tracking-widest text-slate-300 transition hover:border-danger hover:text-danger-soft"
                >
                  Sign out everywhere else
                </button>
              </form>
              <p className="text-sm text-slate-500">
                Lost or shared a device? Revoke every other signed-in session and keep only this
                browser.
              </p>
            </div>
          </div>
        )}
        {pendingInstall && (
          <section className="mt-8 rounded-2xl border border-accent/30 bg-accent/5 p-6">
            <h2 className="font-semibold text-white">
              Finish connecting <span className="font-mono">{pendingInstall}</span>
            </h2>
            <p className="mt-2 text-base text-slate-400">
              The Ascent GitHub App was installed on{" "}
              <span className="font-mono">{pendingInstall}</span>. Re-sync your GitHub access to
              load its repositories — this refreshes your session without signing you out.
            </p>
            <div className="mt-4">
              <GitHubSignInButton
                variant="nav"
                resync
                next={`/connect?org=${encodeURIComponent(pendingInstall)}`}
                label="Re-sync to load repositories"
                pendingLabel="Re-syncing…"
              />
            </div>
          </section>
        )}
        {installs.length === 0 && !pendingInstall ? (
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="font-semibold text-white">Install the GitHub App</h2>
            <p className="mt-2 text-base text-slate-400">
              You&apos;ll choose which repositories Ascent can read (Contents + Metadata,
              read-only). After installing, you&apos;ll land back here with your repo list.
            </p>
            {installUrl ? (
              <a
                href={installUrl}
                className="focus-ring mt-4 inline-block rounded-lg bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
              >
                Install on GitHub →
              </a>
            ) : (
              <p className="mt-4 text-base text-slate-500">
                Set <code className="font-mono text-slate-300">GITHUB_APP_SLUG</code> to enable the install link.
              </p>
            )}
          </div>
        ) : installs.length > 0 ? (
          <div className="mt-8 space-y-8">
            {/* "Add or manage" should land on the screen where repos are actually granted: the
                installation's Configure page when it's unambiguous (a single install with a known
                id — also works without GITHUB_APP_SLUG), else the generic install page. */}
            {(() => {
              const soleId = installs.length === 1 ? installs[0]?.id : undefined;
              const manageUrl = soleId ? appConfigureUrl(soleId) : installUrl;
              return manageUrl ? (
                <a
                  href={manageUrl}
                  className="focus-ring inline-block rounded-lg border border-accent/40 px-3 py-1.5 font-mono text-sm uppercase tracking-widest text-accent transition hover:border-accent hover:bg-accent/10 hover:text-accent-soft"
                >
                  + Add or manage repositories on GitHub →
                </a>
              ) : null;
            })()}
            {installs.map((inst) => (
              <div key={`${inst.login}:${inst.id ?? ""}`}>
                <h2 className="mb-3 text-lg font-semibold text-white">
                  Repositories for <span className="font-mono">{inst.login}</span>
                </h2>
                <InstallationRepos org={inst.login} installationId={inst.id} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
