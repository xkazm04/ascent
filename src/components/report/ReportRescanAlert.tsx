"use client";

// The FAILED half of the in-place re-scan banner. Split out of ReportRescanBanner so that file stays
// the progress row, and because this half is where the classification lives.
//
// A re-test can fail for the same reasons a first scan can — the sign-in wall (401), the monthly
// public-scan quota (429), the credit gate (402), an unreadable repo (404) — but the banner used to
// keep only the message, so every one of them rendered a "Retry" that re-trips the same gate and no
// way out. The class now travels with the error (ScanErrorClass), and each class gets the action
// that can actually clear it. Retry is offered ONLY for the unclassified/transient failure.
// The report underneath is never touched in any case — that is the whole point of the in-place path.

import type { EmptyStateAction } from "@/components/EmptyState";
import { SupabaseSignInButton } from "@/components/SupabaseAuthButtons";
import { formatResetAt } from "@/components/report/QuotaNotice";
import { creditsOrgHref } from "@/components/report/CreditsNotice";
import type { ScanErrorClass } from "@/components/report/useReportScan";

/** True when nothing classified the failure — the transient class (timeout, network, upstream blip),
 *  and the only one a plain Retry can clear. */
export function isTransientScanError(cls: ScanErrorClass): boolean {
  return !cls.blocked && !cls.authRequired && !cls.notFound && !cls.credits;
}

/** The class-specific tail sentence appended after the server's message, when it adds something the
 *  message doesn't already carry (the quota reset horizon, the refused balance). */
function tailCopy(cls: ScanErrorClass): string | null {
  if (cls.blocked) return `The limit resets ${formatResetAt(cls.blocked.resetAt)}.`;
  if (cls.credits) {
    const n = cls.credits.balance;
    return `${Number.isFinite(n) ? n : 0} scan credit${n === 1 ? "" : "s"} left.`;
  }
  return null;
}

/** The one link that can clear this class of failure, if it is a link (the sign-in CTA is a button). */
function classLink(cls: ScanErrorClass, repo: string): EmptyStateAction | null {
  if (cls.credits) return { label: "Add credits →", href: creditsOrgHref(repo) ?? "/pricing" };
  if (cls.blocked) return { label: "See plans →", href: "/pricing" };
  if (cls.notFound) return { label: "Private repo? Connect GitHub", href: "/onboarding" };
  return null;
}

const ACTION_CLASS =
  "focus-ring shrink-0 rounded-md border border-danger/40 px-3 py-1 type-body-sm font-medium transition hover:bg-danger/10";

export function RescanAlert({
  repo,
  error,
  errorClass,
  signInNext,
  onRetry,
  onDismiss,
}: {
  repo: string;
  error: string;
  errorClass: ScanErrorClass;
  /** Where to return after the sign-in round-trip (carries the scan's scope). */
  signInNext: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const transient = isTransientScanError(errorClass);
  const tail = tailCopy(errorClass);
  const link = classLink(errorClass, repo);
  return (
    <div
      role="alert"
      className="animate-fade-up sticky top-16 z-10 mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 type-body text-danger-soft backdrop-blur"
    >
      <span aria-hidden>⚠</span>
      <span className="flex-1">
        Re-scan failed. Your existing report is unchanged. {error}
        {tail && <span className="ml-1 type-mono-sm tabular-nums">{tail}</span>}
      </span>
      {/* Sign-in is a client button, not a link — it drives the OAuth redirect itself. */}
      {errorClass.authRequired && (
        <SupabaseSignInButton variant="nav" label="Sign in to re-scan" next={signInNext} />
      )}
      {link && (
        <a href={link.href} className={ACTION_CLASS}>
          {link.label}
        </a>
      )}
      {/* Retry only where it can succeed: a classified refusal re-trips the same gate. */}
      {transient && (
        <button type="button" onClick={onRetry} className={ACTION_CLASS}>
          Retry
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="focus-ring shrink-0 rounded-md border border-slate-700 px-3 py-1 type-body-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
      >
        Dismiss
      </button>
    </div>
  );
}
