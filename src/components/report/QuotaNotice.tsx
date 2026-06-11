"use client";

// Free weekly public-scan allowance surfaces for the report page — the banner shown above a
// finished report and the blocked state when the limit is exhausted. Driven by the x-ascent-quota-*
// response headers (anonymous per-IP vs signed-in per-user, elevated). Split out of
// ReportClientStatus so that module stays focused on the scan lifecycle (loading/empty/SSE).

import { EmptyState } from "@/components/EmptyState";
import { SupabaseSignInButton } from "@/components/SupabaseAuthButtons";

/** Free weekly public-scan allowance attribution, from the x-ascent-quota-scope header. */
export type QuotaScope = "anon" | "user";

/**
 * Whether a "Sign in for more" CTA can actually do anything: only when this scan was ANONYMOUS
 * (scope "anon") AND Supabase auth is wired up client-side (the NEXT_PUBLIC_* envs are inlined at
 * build, so this is safe in a client component). A signed-in viewer is already at the elevated
 * tier, and without Supabase configured there's no sign-in to offer.
 */
function canOfferSignIn(scope: QuotaScope): boolean {
  return (
    scope === "anon" &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

/** Human-friendly date a weekly quota window resets on (epoch ms). Coarse — a day is precise enough. */
export function formatResetAt(resetAt: number | null): string {
  if (!resetAt || !Number.isFinite(resetAt)) return "in a few days";
  return `on ${new Date(resetAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/**
 * The blocked state when the weekly public-scan limit is exhausted. No "Try again" (an immediate
 * retry just re-trips the gate); instead it surfaces when the window resets and, for an anonymous
 * caller, a sign-in CTA that lifts the limit to the elevated per-user tier.
 */
export function QuotaBlocked({
  message,
  scope,
  signInNext,
}: {
  message: string;
  scope: QuotaScope;
  signInNext: string;
}) {
  return (
    <EmptyState icon="⏳" title="Weekly scan limit reached" body={message} actions={[{ label: "← Back home", href: "/" }]}>
      {canOfferSignIn(scope) && (
        <SupabaseSignInButton variant="primary" label="Sign in for a higher limit" next={signInNext} />
      )}
    </EmptyState>
  );
}

/**
 * Subtle banner shown above a finished report for public scans, surfacing the free weekly allowance
 * left (from the x-ascent-quota-* response headers). Quiet by design — informs without alarming, and
 * only renders when the weekly gate counted this scan. For an anonymous caller it also offers a
 * "Sign in for more" CTA that lifts the limit to the elevated per-user tier.
 */
export function QuotaBanner({
  remaining,
  resetAt,
  scope,
  signInNext,
}: {
  remaining: number;
  resetAt: number | null;
  scope: QuotaScope;
  signInNext: string;
}) {
  const last = remaining <= 0;
  return (
    <div
      role="status"
      className="mx-auto mb-4 flex max-w-3xl items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-400"
    >
      <span aria-hidden>◷</span>
      <span className="flex-1">
        {last ? (
          <>That was your last free public scan this week — the limit resets {formatResetAt(resetAt)}.</>
        ) : (
          <>
            <span className="font-medium text-slate-200">{remaining}</span> free public scan
            {remaining === 1 ? "" : "s"} left this week.
          </>
        )}
      </span>
      {canOfferSignIn(scope) && (
        <SupabaseSignInButton variant="nav" label="Sign in for more" next={signInNext} />
      )}
    </div>
  );
}
