"use client";

// Live "free scans left this week" meter for the landing page — reads GET /api/quota (read-only,
// never consumes a slot) so a visitor sees their real remaining allowance BEFORE committing a scan,
// instead of only discovering the limit when a scan is blocked. Renders nothing when the gate is
// inactive (DB-less / disabled), so it's invisible on deployments without the weekly quota.

import { useEffect, useState } from "react";

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
    fetch("/api/quota")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d) setQ(d as Quota);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!q || !q.enforced) return null;
  const low = q.remaining <= 1;
  const reset = q.resetAt ? new Date(q.resetAt).toLocaleDateString() : null;

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
