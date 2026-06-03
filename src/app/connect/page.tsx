import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { SignInNotice } from "@/components/SignInNotice";
import { GitHubSignInButton } from "@/components/GitHubSignInButton";
import { InstallationRepos } from "@/components/connect/InstallationRepos";
import { appInstallUrl, isAppConfigured } from "@/lib/github/app";
import { getSessionState, isAuthConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ERROR_COPY: Record<string, string> = {
  not_configured: "The GitHub App isn't configured on this deployment.",
  missing_installation: "GitHub didn't return an installation id. Please try installing again.",
  setup_failed: "We couldn't finish setting up the installation. Please try again.",
  oauth: "Sign-in could not be verified. Please try again.",
  oauth_failed: "Sign-in failed. Please try again.",
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
  searchParams: Promise<{ org?: string; installation_id?: string; error?: string; resynced?: string }>;
}) {
  const { org, installation_id, error, resynced } = await searchParams;
  const installUrl = appInstallUrl();
  const { session, status } = await getSessionState();

  const header = (
    <>
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">Connect GitHub</div>
      <h1 className="mt-1 text-2xl font-bold text-white">Scan your private repositories</h1>
      <p className="mt-2 max-w-2xl text-slate-400">
        Install the Ascent GitHub App on an organization or account. Inference runs against
        your repositories using a short-lived installation token — Ascent stores only the
        derived scores and evidence, never your source.
      </p>
      {error && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger-soft"
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
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="font-semibold text-white">GitHub App not configured</h2>
            <p className="mt-2 text-sm text-slate-400">
              Set <code className="font-mono text-slate-300">GITHUB_APP_ID</code> and{" "}
              <code className="font-mono text-slate-300">GITHUB_APP_PRIVATE_KEY</code> (see{" "}
              <span className="font-mono text-slate-300">docs/GITHUB_APP.md</span>) to enable
              private-repo scanning. Public scans work without it.
            </p>
            <Link href="/" className="mt-4 inline-block rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-accent hover:text-white">
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

  // Build the installations to display: the signed-in user's, plus any just-installed
  // one carried in the query (auth-off mode relies entirely on the query).
  const installs: { login: string; id?: string }[] = (session?.installations ?? []).map((i) => ({
    login: i.login,
    id: String(i.id),
  }));
  if (org && !installs.some((i) => (installation_id ? i.id === installation_id : i.login.toLowerCase() === org.toLowerCase()))) {
    installs.push({ login: org, id: installation_id });
  }

  const installCount = session?.installations.length ?? 0;
  // Orgs auto-discovered at login (see src/lib/github/discover.ts): the most-active org we
  // pre-seeded a watchlist for (a ready dashboard), plus not-yet-installed orgs to nudge.
  const seededOrg = session?.seededOrg;
  const suggestedOrgs = session?.suggestedOrgs ?? [];

  return (
    <Shell>
      <div className="animate-fade-up">
        {header}
        {resynced && (
          <div
            role="status"
            className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300"
          >
            GitHub access re-synced — {installCount} installation{installCount === 1 ? "" : "s"} now available.
          </div>
        )}
        {/* Login-time org auto-discovery: a ready-to-explore seeded dashboard + orgs to connect. */}
        {(seededOrg || suggestedOrgs.length > 0) && (
          <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <div className="font-mono text-[11px] uppercase tracking-widest text-accent">
              Discovered from your GitHub
            </div>
            {seededOrg && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
                <p className="text-sm text-slate-300">
                  We pre-loaded <span className="font-mono text-white">{seededOrg}</span>&apos;s most
                  active repositories onto your watchlist — its dashboard is ready to scan.
                </p>
                <Link
                  href={`/org/${encodeURIComponent(seededOrg)}`}
                  className="focus-ring shrink-0 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-[#04070e] transition hover:bg-emerald-400"
                >
                  View {seededOrg} dashboard →
                </Link>
              </div>
            )}
            {suggestedOrgs.length > 0 && (
              <div className="mt-3">
                <p className="text-sm text-slate-400">
                  You belong to {suggestedOrgs.length === 1 ? "this organization" : "these organizations"} —
                  install the App to scan private repos, or{" "}
                  <Link href="/onboarding" className="text-accent hover:text-white">
                    scan their public repos now →
                  </Link>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {suggestedOrgs.map((o) => (
                    <Link
                      key={o}
                      href="/onboarding"
                      className="focus-ring rounded-full border border-slate-700 px-3 py-1 font-mono text-xs text-slate-300 transition hover:border-accent hover:text-white"
                    >
                      {o}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
        {/* Self-serve refresh: re-fetch installations and re-issue the session without waiting
            out the 7-day cookie, so a repo/org just added on GitHub shows up immediately. */}
        {session && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <GitHubSignInButton
              variant="nav"
              resync
              next="/connect"
              label="Re-sync access"
              pendingLabel="Re-syncing…"
            />
            <p className="text-xs text-slate-500">
              Added a repo or org on GitHub but don&apos;t see it here? Re-sync to refresh your
              installations without signing out.
            </p>
          </div>
        )}
        {installs.length === 0 ? (
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="font-semibold text-white">Install the GitHub App</h2>
            <p className="mt-2 text-sm text-slate-400">
              You&apos;ll choose which repositories Ascent can read (Contents + Metadata,
              read-only). After installing, you&apos;ll land back here with your repo list.
            </p>
            {installUrl ? (
              <a
                href={installUrl}
                className="focus-ring mt-4 inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent transition hover:bg-accent-soft"
              >
                Install on GitHub →
              </a>
            ) : (
              <p className="mt-4 text-sm text-slate-500">
                Set <code className="font-mono text-slate-300">GITHUB_APP_SLUG</code> to enable the install link.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            {installUrl && (
              <a href={installUrl} className="focus-ring rounded-sm font-mono text-xs uppercase tracking-widest text-accent hover:text-accent-soft">
                + Add or manage repositories on GitHub →
              </a>
            )}
            {installs.map((inst) => (
              <div key={`${inst.login}:${inst.id ?? ""}`}>
                <h2 className="mb-3 text-lg font-semibold text-white">
                  Repositories for <span className="font-mono">{inst.login}</span>
                </h2>
                <InstallationRepos org={inst.login} installationId={inst.id} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
