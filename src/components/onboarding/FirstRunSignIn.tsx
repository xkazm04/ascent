// The first thing a signed-out visitor sees on /onboarding, and it differs by deployment.
//
// Hosted cloud: ENCOURAGE the GitHub sign-in. Identity is what unlocks history, private repos and the
// org dashboard, and a visitor who scans anonymously lands in a public-only corner of the product and
// reads it as the product. The wizard stays reachable below — the public path is real — but the pitch
// is the button. Self-hosted with a login wall: there is nothing to encourage, only a wall to pass,
// so it renders the plain sign-in notice the org pages already use.
//
// Server component: no hooks. The sign-in buttons are client components it composes.

import { SignInNotice } from "@/components/SignInNotice";
import { SupabaseSignInButton } from "@/components/SupabaseAuthButtons";
import { GitHubSignInButton } from "@/components/GitHubSignInButton";
import { Kicker, Surface } from "@/components/ui";
import type { FirstRunAuth } from "@/lib/first-run";

const NEXT = "/onboarding";

export function FirstRunSignIn({ mode, auth }: { mode: "cloud" | "self-hosted"; auth: FirstRunAuth }) {
  if (mode === "self-hosted") {
    return <SignInNotice next={NEXT} provider={auth === "github" ? "github" : "supabase"} />;
  }
  return (
    <Surface radius="2xl" className="tick-corners mb-8 p-6 sm:p-8">
      <Kicker as="span">Start here</Kicker>
      <h2 className="mt-2 type-heading font-bold text-white">Sign in with GitHub to scan your organization</h2>
      <p className="mt-2 max-w-2xl type-body leading-relaxed text-slate-300">
        One round-trip. Your scans persist under your account, private repositories become reachable once the
        Ascent GitHub App is installed, and the org dashboard fills in as results stream back.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        {auth === "supabase" ? (
          <SupabaseSignInButton next={NEXT} label="Sign in with GitHub" />
        ) : auth === "github" ? (
          <GitHubSignInButton next={NEXT} label="Sign in with GitHub" />
        ) : null}
        <span className="type-body-sm text-slate-500">
          Or scan public repositories without an account, below — they don&apos;t persist to a dashboard of yours.
        </span>
      </div>
    </Surface>
  );
}
