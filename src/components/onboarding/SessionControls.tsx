// Self-serve session controls, per auth stack (src/lib/onboarding-context.ts picks the stack):
//  - "dormant" (custom-OAuth session): re-sync installations without signing out, and revoke every
//    other signed-in session. Relocated verbatim from the retired /connect page.
//  - "supabase" (the live wall): the revoke form only. POST /api/auth/revoke-sessions signs out the
//    viewer's OTHER sessions there (signOut scope "others"); the re-sync buttons go to /api/auth/login,
//    which only completes on the custom stack, so they are not rendered.
// Server-safe: the sign-in button is the client piece.

import { GitHubSignInButton } from "@/components/GitHubSignInButton";
import type { SessionControlsStack } from "@/lib/onboarding-context";

export function SessionControls({
  stack,
  pendingInstall,
}: {
  stack: SessionControlsStack;
  pendingInstall?: string | null;
}) {
  const canResync = stack === "dormant";
  return (
    <div className="mt-10 space-y-3 border-t border-divider pt-6">
      {canResync && pendingInstall && (
        <section className="mb-5 rounded-2xl border border-accent/30 bg-accent/5 p-6">
          <h2 className="font-semibold text-white">
            Finish connecting <span className="font-mono">{pendingInstall}</span>
          </h2>
          <p className="mt-2 type-body text-slate-400">
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
      {canResync && (
        <div className="flex flex-wrap items-center gap-3">
          <GitHubSignInButton variant="nav" resync next="/onboarding" label="Re-sync access" pendingLabel="Re-syncing…" />
          <p className="type-body-sm text-slate-500">
            Added a repo or org on GitHub but don&apos;t see it here? Re-sync to refresh your installations without
            signing out.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <form action="/api/auth/revoke-sessions" method="post" className="contents">
          <button
            type="submit"
            className="focus-ring rounded-md border border-slate-700 px-3 py-1.5 type-mono-sm uppercase tracking-widest text-slate-300 transition hover:border-danger hover:text-danger-soft"
          >
            Sign out everywhere else
          </button>
        </form>
        <p className="type-body-sm text-slate-500">
          Lost or shared a device? Revoke every other signed-in session and keep only this browser.
        </p>
      </div>
    </div>
  );
}
