"use client";

// Supabase GitHub OAuth sign-in / sign-out affordances. The sign-in button kicks off the OAuth
// redirect (browser → Supabase → GitHub → /auth/callback); the sign-out button clears the session
// cookies and refreshes. Styled to match the dormant custom-OAuth GitHubSignInButton so the
// affordance looks identical regardless of which auth backend is active.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Variant = "primary" | "nav";

/** GitHub Octocat mark. Decorative — the accessible name comes from the button label. */
function GitHubMark({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
      style={{ width: size, height: size }}
    />
  );
}

const VARIANTS: Record<Variant, { box: string; icon: number; idle: string; busy: string }> = {
  primary: {
    box: "rounded-xl bg-accent px-5 py-2.5 text-base font-semibold text-on-accent hover:bg-accent-soft",
    icon: 18,
    idle: "Sign in with GitHub",
    busy: "Redirecting to GitHub…",
  },
  nav: {
    box: "rounded-md border border-slate-700 px-3 py-1.5 text-base text-accent hover:border-accent",
    icon: 14,
    idle: "Sign in",
    busy: "Redirecting…",
  },
};

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
  const v = VARIANTS[variant];
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
