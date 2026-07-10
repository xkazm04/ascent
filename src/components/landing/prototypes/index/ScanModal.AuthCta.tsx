import Link from "next/link";
import { GitHubSignInButton } from "@/components/GitHubSignInButton";
import { SupabaseSignInButton } from "@/components/SupabaseAuthButtons";
import { GitHubMark } from "@/components/auth/buttonChrome";

/** Which GitHub sign-in backend the deployment runs — decided server-side and passed down so the
 *  modal renders the matching CTA (or a get-started link when auth isn't configured at all). */
export type AuthMode = "supabase" | "github" | null;

/** Renders the GitHub sign-in affordance for whichever backend is configured (or a get-started
 *  fallback when none is). Shared by the gated "sign in to scan" panel and the private-repo connect CTA. */
export function SignInButton({ auth, next, label }: { auth: AuthMode; next: string; label: string }) {
  const cls = "w-full justify-center";
  if (auth === "supabase") return <SupabaseSignInButton next={next} label={label} className={cls} />;
  if (auth === "github") return <GitHubSignInButton next={next} label={label} className={cls} />;
  // No auth backend on this deployment — fall back to the get-started flow rather than a dead button.
  return (
    <Link
      href="/onboarding"
      className="focus-ring inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
    >
      <GitHubMark size={18} /> {label} →
    </Link>
  );
}

/** The private-repo GitHub connect CTA, gated on the consent checkbox. Until consent is given it's a
 *  disabled stand-in; once given it becomes the real connect for whichever backend is configured. */
export function AuthCta({ auth, consent }: { auth: AuthMode; consent: boolean }) {
  if (!consent) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-slate-800 px-5 py-2.5 text-base font-semibold text-slate-500"
      >
        <GitHubMark size={18} /> Continue with GitHub
      </button>
    );
  }
  return <SignInButton auth={auth} next="/connect" label="Continue with GitHub" />;
}
