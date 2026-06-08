// Shown on auth-gated pages when no session is present (and auth is configured).
// `expired` distinguishes "your session timed out" from a first-time prompt.
// Routes through the canonical EmptyState (page scale): the expired banner rides the `alert`
// slot and the GitHub CTA rides the `children` action slot, so this is no longer a hand-rolled
// notice scaffold that can drift from the rest of the app.

import { EmptyState } from "@/components/EmptyState";
import { GitHubSignInButton } from "@/components/GitHubSignInButton";

export function SignInNotice({ next, expired = false }: { next: string; expired?: boolean }) {
  return (
    <EmptyState
      icon="🔐"
      title={expired ? "Your session expired" : "Sign in to continue"}
      alert={
        expired ? (
          <p
            role="alert"
            className="mt-3 max-w-md rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-sm text-amber-300"
          >
            You were signed out after a period of inactivity. Sign in again to pick up where you left off.
          </p>
        ) : null
      }
      body={
        expired
          ? "Re-authenticate with GitHub to restore access to your repositories, history, and usage."
          : "Connect your GitHub account to access private repositories, history, and usage."
      }
    >
      <GitHubSignInButton next={next} />
    </EmptyState>
  );
}
