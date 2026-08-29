// Self-serve session controls for the DORMANT custom-OAuth session: re-sync installations without
// signing out, and revoke every other signed-in session. Relocated verbatim from the retired /connect
// page; rendered only when that session exists (under the Supabase wall it never does — see the known
// gap in docs/features/github/auth.md). Server-safe: the sign-in button is the client piece.

import { GitHubSignInButton } from "@/components/GitHubSignInButton";

export function SessionControls({ pendingInstall }: { pendingInstall?: string | null }) {
  return (
    <div className="mt-10 space-y-3 border-t border-divider pt-6">
      {pendingInstall && (
        <section className="mb-5 rounded-2xl border border-accent/30 bg-accent/5 p-6">
          <h2 className="font-semibold text-white">
            Finish connecting <span className="font-mono">{pendingInstall}</span>
          </h2>
          <p className="mt-2 text-base text-slate-400">
            The Ascent GitHub App was installed on <span className="font-mono">{pendingInstall}</span>. Re-sync
            your GitHub access to load its repositories. This refreshes your session without signing you out.
          </p>
          <div className="mt-4">
            <GitHubSignInButton
              variant="nav"
              resync
              next={`/onboarding?org=${encodeURIComponent(pendingInstall)}`}
              label="Re-sync to load repositories"
              pendingLabel="Re-syncing…"
            />
          </div>
        </section>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <GitHubSignInButton variant="nav" resync next="/onboarding" label="Re-sync access" pendingLabel="Re-syncing…" />
        <p className="text-sm text-slate-500">
          Added a repo or org on GitHub but don&apos;t see it here? Re-sync to refresh your installations without
          signing out.
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
          Lost or shared a device? Revoke every other signed-in session and keep only this browser.
        </p>
      </div>
    </div>
  );
}
