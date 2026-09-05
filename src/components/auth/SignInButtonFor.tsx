"use client";

// Picks the GitHub sign-in CTA for whichever auth backend the deployment runs — Supabase OAuth (active)
// or the dormant custom OAuth — so callers can offer "sign in" without re-deriving the backend choice.
// Renders nothing when no backend is configured (auth === null): there's nothing to sign into, and the
// caller decides whether to show a fallback. Mirrors the inline pick in SignInNotice / the scan dialog.

import { GitHubSignInButton } from "@/components/GitHubSignInButton";
import { SupabaseSignInButton } from "@/components/SupabaseAuthButtons";
import type { SignInButtonVariant } from "@/components/auth/buttonChrome";

export type AuthMode = "supabase" | "github" | null;

export function SignInButtonFor({
  auth,
  next,
  label,
  className = "",
  variant = "primary",
}: {
  auth: AuthMode;
  next: string;
  label?: string;
  className?: string;
  variant?: SignInButtonVariant;
}) {
  if (auth === "supabase") return <SupabaseSignInButton next={next} label={label} className={className} variant={variant} />;
  if (auth === "github") return <GitHubSignInButton next={next} label={label} className={className} variant={variant} />;
  return null;
}
