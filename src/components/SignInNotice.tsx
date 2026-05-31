// Shown on auth-gated pages when no session is present (and auth is configured).
// `expired` distinguishes "your session timed out" from a first-time prompt.

import { GitHubSignInButton } from "@/components/GitHubSignInButton";

export function SignInNotice({ next, expired = false }: { next: string; expired?: boolean }) {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <div className="text-4xl" aria-hidden="true">
        🔐
      </div>
      <h1 className="mt-4 text-2xl font-bold text-white">
        {expired ? "Your session expired" : "Sign in to continue"}
      </h1>
      {expired && (
        <p role="alert" className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-sm text-amber-300">
          You were signed out after a period of inactivity. Sign in again to pick up where you left off.
        </p>
      )}
      <p className="mt-2 max-w-md text-slate-400">
        Connect your GitHub account to access private repositories, history, and usage.
      </p>
      <div className="mt-6">
        <GitHubSignInButton next={next} />
      </div>
    </div>
  );
}
