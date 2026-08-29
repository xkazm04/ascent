// The `?error=` / `?revoked=` / `?resynced=` banners that every auth and App route lands on.
//
// These codes used to render on /connect. That page is gone (its jobs moved here — see
// docs/features/onboarding/wizard.md), and a redirect that carries an error code to a surface
// that doesn't read it is a silent dead-end (the exact failure the Supabase callback fixed once
// already, when it stopped sending `/?auth_error=1` to a home page that never looked). So every
// code any route can emit has copy here; the fallback is the one line nobody should ever see.
//
// Server component: static copy only.

export const ONBOARDING_ERROR_COPY: Record<string, string> = {
  not_configured: "The GitHub App isn't configured on this deployment.",
  missing_installation: "GitHub didn't return an installation id. Please try installing again.",
  setup_failed: "We couldn't finish setting up the installation. Please try again.",
  auth_required: "Sign in first, then finish installing the GitHub App — the install has to be tied to your account.",
  forbidden: "Your account can't claim that installation: only the account itself or one of its admins can.",
  auth_stack_retired: "This sign-in path is retired on this deployment. Use the GitHub sign-in button instead.",
  oauth: "Sign-in could not be verified. Please try again.",
  oauth_failed: "Sign-in failed. Please try again.",
  denied: "Sign-in was cancelled on GitHub. Granting access lets Ascent scan your repositories, so sign in again when you're ready.",
  csrf: "Your sign-in attempt expired or didn't match this browser session. Please try signing in again.",
  revoke: "We couldn't sign out your other sessions. Please try again.",
};

export function OnboardingErrorBanner({
  error,
  resynced,
  revoked,
  installCount = 0,
}: {
  error?: string;
  resynced?: string;
  revoked?: string;
  installCount?: number;
}) {
  return (
    <>
      {error && (
        <div role="alert" className="mb-6 rounded-xl border border-danger/30 bg-danger/5 p-4 text-base text-danger-soft">
          {ONBOARDING_ERROR_COPY[error] ?? "Something went wrong."}
        </div>
      )}
      {resynced && (
        <div role="status" className="mb-6 rounded-xl border border-success/30 bg-success/10 p-4 text-base text-success-soft">
          GitHub access re-synced. {installCount} installation{installCount === 1 ? "" : "s"} now available.
        </div>
      )}
      {revoked && (
        <div role="status" className="mb-6 rounded-xl border border-success/30 bg-success/10 p-4 text-base text-success-soft">
          {revoked === "others"
            ? "Signed out of all other sessions. This browser stays signed in."
            : "Your session was refreshed, but other sessions can't be centrally revoked without a database."}
        </div>
      )}
    </>
  );
}
