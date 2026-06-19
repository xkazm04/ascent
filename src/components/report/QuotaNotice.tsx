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
  // Always offer a paid upgrade path so the blocked moment converts instead of dead-ending — it's the
  // PRIMARY action for a signed-in caller (who has no sign-in upsell), secondary behind sign-in for an
  // anonymous one.
  const offerSignIn = canOfferSignIn(scope);
  return (
    <EmptyState
      icon="⏳"
      title="Weekly scan limit reached"
      body={message}
      actions={[
        { label: "See plans →", href: "/pricing", primary: !offerSignIn },
        { label: "← Back home", href: "/" },
      ]}
    >
      {offerSignIn && (
        <SupabaseSignInButton variant="primary" label="Sign in for a higher limit" next={signInNext} />
      )}
    </EmptyState>
  );
}

/**
 * Notice above a report served from the LAST SAVED scan because the weekly limit blocked a fresh
 * one — the "stale + quota" salvage path. Louder than QuotaBanner (warn-tinted: the data shown is
 * not head-fresh) but still a banner, not a wall: the user keeps the answer they came for while
 * the reset date and sign-in upsell stay visible.
 */
export function QuotaStaleNotice({
  scannedAt,
  resetAt,
  scope,
  signInNext,
}: {
  /** ISO timestamp of the served (stale) scan, from report.scannedAt. */
  scannedAt: string;
  resetAt: number | null;
  scope: QuotaScope;
  signInNext: string;
}) {
  const scannedMs = Date.parse(scannedAt);
  const scannedOn = Number.isFinite(scannedMs)
    ? ` from ${new Date(scannedMs).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "";
  return (
    <div
      role="status"
      className="mx-auto mb-4 flex max-w-3xl items-center gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-slate-300"
    >
      <span aria-hidden className="text-warn">
        ◷
      </span>
      <span className="flex-1">
        Showing the last saved scan{scannedOn} — your free weekly limit is used; it resets{" "}
        {formatResetAt(resetAt)}.
      </span>
      {canOfferSignIn(scope) ? (
        <SupabaseSignInButton variant="nav" label="Sign in for more" next={signInNext} />
      ) : (
        <a href="/pricing" className="shrink-0 font-mono text-sm text-accent hover:text-white">
          See plans →
        </a>
      )}
    </div>
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
      className="mx-auto mb-4 flex max-w-3xl items-center gap-2 rounded-lg border border-divider bg-surface/40 px-3 py-2 text-sm text-slate-400"
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
      {canOfferSignIn(scope) ? (
        <SupabaseSignInButton variant="nav" label="Sign in for more" next={signInNext} />
      ) : (
        last && (
          <a href="/pricing" className="shrink-0 font-mono text-sm text-accent hover:text-white">
            See plans →
          </a>
        )
      )}
    </div>
  );
}
