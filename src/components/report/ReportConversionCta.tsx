"use client";

// Activation CTA at the foot of a repo report — the funnel-continuation nudge for the costliest,
// highest-engagement moment in the first run (minutes of wait, maximum "wow"). A single repo scan is
// a one-off; the product's value is the org rollup and tracking a repo over time. Branched on the
// effective viewer (honors the dev auth-bypass via /api/auth/viewer): a signed-out first-timer is
// pulled toward the org scan + an account (save history / re-scan alerts); a signed-in viewer toward
// the cross-repo dashboard. Renders nothing until the viewer resolves so it never flips copy on hydrate.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Surface, Kicker } from "@/components/ui";

export function ReportConversionCta() {
  // null = unresolved; the card stays hidden until we know which side of the funnel the viewer is on,
  // so a signed-in viewer never momentarily sees the "sign in" copy (and vice versa).
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/viewer")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => active && setSignedIn(Boolean(d?.signedIn)))
      .catch(() => active && setSignedIn(false));
    return () => {
      active = false;
    };
  }, []);

  if (signedIn === null) return null;

  return (
    <Surface radius="2xl" className="relative overflow-hidden p-6" data-testid="report-conversion-cta">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(36rem_14rem_at_50%_-28%,rgba(59,158,255,0.12),transparent_68%)]"
      />
      <div className="relative flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <Kicker>{signedIn ? "Go fleet-wide" : "Make this more than a one-off"}</Kicker>
          <p className="mt-1.5 max-w-xl text-base leading-relaxed text-slate-300">
            {signedIn
              ? "Scan your whole org in one shot to see this repo ranked against the rest — common gaps to fix once, and the repo-specific ones."
              : "Scan your whole org in one shot, then sign in to save history and get alerted when a repo's score moves."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Link
            href="/onboarding"
            className="focus-ring inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
          >
            {signedIn ? "Scan your org" : "Scan your whole org"} <span aria-hidden>→</span>
          </Link>
          {!signedIn && (
            <Link
              href="/connect"
              className="focus-ring inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-base text-slate-300 transition hover:border-accent hover:text-white"
            >
              Sign in to track over time
            </Link>
          )}
        </div>
      </div>
    </Surface>
  );
}
