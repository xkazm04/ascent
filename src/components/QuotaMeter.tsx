"use client";

// Live "free scans left this week" meter for the landing page — reads GET /api/quota (read-only,
// never consumes a slot) so a visitor sees their real remaining allowance BEFORE committing a scan,
// instead of only discovering the limit when a scan is blocked. Renders nothing when the gate is
// inactive (DB-less / disabled), so it's invisible on deployments without the weekly quota.

import { useEffect, useState } from "react";
import { formatResetAt } from "@/components/report/QuotaNotice";

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
    const load = () => {
      fetch("/api/quota")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (active && d) setQ(d as Quota);
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
    <p className={`mt-2 font-mono text-sm ${low ? "text-amber-300" : "text-slate-500"}`}>
      <span className="font-semibold">{q.remaining}</span> of {q.limit} free scans left this week
      {q.scope === "anon" && (
        <>
          {" "}
          · <span className="text-slate-400">sign in for more</span>
        </>
      )}
      {q.remaining === 0 && reset && <> · resets {reset}</>}
    </p>
  );
}
