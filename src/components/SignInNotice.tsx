// Shown on auth-gated pages when no session is present (and auth is configured).
// `expired` distinguishes "your session timed out" from a first-time prompt.
// Routes through the canonical EmptyState (page scale): the expired banner rides the `alert`
// slot and the GitHub CTA rides the `children` action slot, so this is no longer a hand-rolled
// notice scaffold that can drift from the rest of the app.

import { EmptyState } from "@/components/EmptyState";
import { GitHubSignInButton } from "@/components/GitHubSignInButton";
import { SupabaseSignInButton } from "@/components/SupabaseAuthButtons";

export function SignInNotice({
  next,
  expired = false,
  provider = "github",
}: {
  next: string;
  expired?: boolean;
  /** Which OAuth backend the CTA drives. "supabase" = the active Supabase GitHub login; "github" =
   *  the dormant custom-OAuth button (default, used by the legacy flow). */
  provider?: "github" | "supabase";
}) {
  return (
    <EmptyState
      icon={expired ? "⏳" : "🔐"}
      title={expired ? "Your session expired" : "Sign in to continue"}
      alert={
        expired ? (
          <p
            role="alert"
            className="mt-3 max-w-md rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-base text-amber-300"
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
      {provider === "supabase" ? (
        <SupabaseSignInButton next={next} />
      ) : (
        <GitHubSignInButton next={next} />
      )}
    </EmptyState>
  );
}
