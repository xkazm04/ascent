"use client";

// Live "free scans left this month" meter for the landing page — reads GET /api/quota (read-only,
// never consumes a slot) so a visitor sees their real remaining allowance BEFORE committing a scan,
// instead of only discovering the limit when a scan is blocked. Renders nothing when the gate is
// inactive (DB-less / disabled), so it's invisible on deployments without the monthly quota.

import { useEffect, useState } from "react";
import { canOfferSignIn, formatResetAt } from "@/components/report/QuotaNotice";
import { SupabaseSignInButton } from "@/components/SupabaseAuthButtons";

interface Quota {
  enforced: boolean;
  remaining: number;
  limit: number;
  resetAt: number | null;
  scope: "anon" | "user";
}

export function QuotaMeter() {
  const [q, setQ] = useState<Quota | null>(null);

  useEffect(() => {
    let active = true;
    // Monotonic request id: load() fires on mount AND on focus/visibilitychange/pageshow, so rapid
    // tab-switching launches overlapping /api/quota fetches. Without sequencing, an EARLIER (slower)
    // response can resolve AFTER a later one and clobber the fresh count with a stale "scans left"
    // (e.g. show more than the visitor has, right after a scan). Only the latest-issued load wins;
    // `active` still guards unmount.
    let latest = 0;
    const load = () => {
      const seq = ++latest;
      fetch("/api/quota")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (active && seq === latest && d) setQ(d as Quota);
        })
        .catch(() => {});
    };
    load();
    // Revalidate when the user returns to the page after a scan — a one-shot mount fetch goes stale the
    // moment a scan consumes a slot, leaving the meter showing scans the visitor no longer has. Re-fetch
    // on tab focus, on becoming visible again, and on bfcache restore (browser back from a report).
    const onFocus = () => load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  if (!q || !q.enforced) return null;
  const low = q.remaining <= 1;
  // Only show the reset clause when we actually have a reset time (mirrors the prior guard); reuse
  // the shared formatResetAt so the meter and the report banners render the date the same way.
  const reset = q.resetAt ? formatResetAt(q.resetAt) : null;

  return (
    // Low-allowance warning uses the semantic `warn` token (the same one the report-side QuotaNotice
    // uses for this state) instead of a raw amber hex, so a theme change to "warn" propagates here too.
    <p className={`mt-2 font-mono text-sm ${low ? "text-warn" : "text-slate-500"}`}>
      <span className="font-semibold">{q.remaining}</span> of {q.limit} free scans left this month
      {/* A real CTA, not dead text — and the SAME action hierarchy as the report-side QuotaNotice
          banners (sign in first, plans as fallback), so the two quota surfaces give one answer to
          "what do I do about the limit". Suppressed while the visitor still holds the FULL allowance:
          an upsell before anything has been spent is a premature nudge. */}
      {q.scope === "anon" && q.remaining < q.limit && (
        <>
          {" "}
          ·{" "}
          {canOfferSignIn(q.scope) ? (
            <SupabaseSignInButton variant="nav" label="Sign in for more scans" />
          ) : (
            <a href="/pricing" className="text-accent hover:text-white">
              upgrade for more scans
            </a>
          )}
        </>
      )}
      {q.remaining === 0 && reset && <> · resets {reset}</>}
    </p>
  );
}
