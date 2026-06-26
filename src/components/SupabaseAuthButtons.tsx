"use client";

// Supabase GitHub OAuth sign-in / sign-out affordances. The sign-in button kicks off the OAuth
// redirect (browser → Supabase → GitHub → /auth/callback); the sign-out button clears the session
// cookies and refreshes. Styled to match the dormant custom-OAuth GitHubSignInButton so the
// affordance looks identical regardless of which auth backend is active.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { SignInButtonChrome, signInBoxClass, SIGN_IN_VARIANTS, type SignInButtonVariant } from "@/components/auth/buttonChrome";

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
      className={signInBoxClass(variant, pending, className)}
    >
      <SignInButtonChrome pending={pending} idleLabel={idleLabel} busyLabel={v.busy} variant={variant} />
    </button>
  );
}

export function SignOutButton({ className = "" }: { className?: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function signOut() {
    if (pending) return;
    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signOut();
      if (error) {
        // The sign-out didn't complete (network blip / auth-server hiccup) — surface it and let the user
        // retry instead of navigating home as if signed out (the cookies may still be set: success theater
        // on a shared machine). Mirrors the sibling sign-in button's { error } check.
        console.error("[auth] sign-out failed", error.message);
        return;
      }
      router.refresh();
      router.push("/");
    } finally {
      // Always clear pending — a thrown rejection used to leave the button stuck on "Signing out…" forever
      // (navigation never ran, no finally), permanently disabling sign-out.
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      aria-busy={pending}
      disabled={pending}
      className={`focus-ring rounded-sm hover:text-white ${pending ? "cursor-wait opacity-70" : ""} ${className}`}
    >
      {pending ? "Signing out…" : "Sign out"}
      <span role="status" aria-live="polite" className="sr-only">
        {pending ? "Signing out…" : ""}
      </span>
    </button>
  );
}
