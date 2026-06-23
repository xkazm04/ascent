"use client";

// The single GitHub sign-in CTA used everywhere sign-in appears (the SignInNotice and
// the site header), so the affordance looks and behaves identically across the app and
// future polish is a one-file change. It owns the pending state: on click it swaps the
// GitHub mark for a spinner + "Redirecting to GitHub" copy, blocks further clicks, and
// fades between states. Accessible by default: visible focus ring, stable aria-label,
// aria-busy during the redirect, decorative glyphs hidden, and a polite status region.

import { useState } from "react";
import { GitHubMark, Spinner, SIGN_IN_VARIANTS, type SignInButtonVariant } from "@/components/auth/buttonChrome";

type Variant = SignInButtonVariant;

export function GitHubSignInButton({
  next = "/connect",
  variant = "primary",
  label,
  pendingLabel,
  className = "",
  resync = false,
}: {
  next?: string;
  variant?: Variant;
  label?: string;
  pendingLabel?: string;
  className?: string;
  /** Re-sync access instead of a fresh sign-in: same OAuth round-trip, but GitHub skips
   *  consent and the callback refreshes installations in place. */
  resync?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const v = SIGN_IN_VARIANTS[variant];
  const idleLabel = label ?? v.idle;
  const busyLabel = pendingLabel ?? v.busy;
  const href = `/api/auth/login?next=${encodeURIComponent(next)}${resync ? "&resync=1" : ""}`;

  return (
    <a
      href={href}
      aria-label={idleLabel}
      aria-busy={pending}
      aria-disabled={pending || undefined}
      onClick={(e) => {
        if (pending) {
          e.preventDefault();
          return;
        }
        setPending(true);
      }}
      className={`focus-ring inline-flex items-center justify-center gap-2 transition ${v.box} ${
        pending ? "cursor-wait opacity-70" : ""
      } ${className}`}
    >
      <span
        className="relative inline-flex items-center justify-center"
        style={{ width: v.icon, height: v.icon }}
      >
        <span
          className={`absolute inline-flex transition-opacity duration-150 ${pending ? "opacity-0" : "opacity-100"}`}
        >
          <GitHubMark size={v.icon} />
        </span>
        <span
          className={`absolute inline-flex transition-opacity duration-150 ${pending ? "opacity-100" : "opacity-0"}`}
        >
          <Spinner size={v.icon} />
        </span>
      </span>
      <span className="transition-opacity duration-150">{pending ? busyLabel : idleLabel}</span>
      <span role="status" aria-live="polite" className="sr-only">
        {pending ? busyLabel : ""}
      </span>
    </a>
  );
}
