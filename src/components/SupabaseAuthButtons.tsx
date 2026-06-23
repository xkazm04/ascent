"use client";

// Supabase GitHub OAuth sign-in / sign-out affordances. The sign-in button kicks off the OAuth
// redirect (browser → Supabase → GitHub → /auth/callback); the sign-out button clears the session
// cookies and refreshes. Styled to match the dormant custom-OAuth GitHubSignInButton so the
// affordance looks identical regardless of which auth backend is active.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { GitHubMark, Spinner, SIGN_IN_VARIANTS, type SignInButtonVariant } from "@/components/auth/buttonChrome";

type Variant = SignInButtonVariant;

export function SupabaseSignInButton({
  next = "/",
  variant = "primary",
  label,
  className = "",
}: {
  next?: string;
  variant?: Variant;
  label?: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const v = SIGN_IN_VARIANTS[variant];
  const idleLabel = label ?? v.idle;

  async function signIn() {
    if (pending) return;
    setPending(true);
    const supabase = createSupabaseBrowserClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo },
    });
    if (error) {
      // The redirect didn't happen — surface the failure and let the user retry.
      console.error("[auth] GitHub sign-in failed", error.message);
      setPending(false);
    }
    // On success the browser is navigating to GitHub; keep the pending state until it leaves.
  }

  return (
    <button
      type="button"
      onClick={signIn}
      aria-label={idleLabel}
      aria-busy={pending}
      disabled={pending}
      className={`focus-ring inline-flex items-center justify-center gap-2 transition ${v.box} ${
        pending ? "cursor-wait opacity-70" : ""
      } ${className}`}
    >
      <span className="relative inline-flex items-center justify-center" style={{ width: v.icon, height: v.icon }}>
        <span className={`absolute inline-flex transition-opacity duration-150 ${pending ? "opacity-0" : "opacity-100"}`}>
          <GitHubMark size={v.icon} />
        </span>
        <span className={`absolute inline-flex transition-opacity duration-150 ${pending ? "opacity-100" : "opacity-0"}`}>
          <Spinner size={v.icon} />
        </span>
      </span>
      <span>{pending ? v.busy : idleLabel}</span>
      <span role="status" aria-live="polite" className="sr-only">
        {pending ? v.busy : ""}
      </span>
    </button>
  );
}

export function SignOutButton({ className = "" }: { className?: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function signOut() {
    if (pending) return;
    setPending(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push("/");
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className={`focus-ring rounded-sm hover:text-white ${pending ? "cursor-wait opacity-70" : ""} ${className}`}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
