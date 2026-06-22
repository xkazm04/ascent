"use client";

// EXEC-6: owner control that mints a signed read-only briefing link and copies it. POSTs the current
// window to /api/org/briefing/share; the returned /share/briefing/[token] path needs no account.

import { useState } from "react";

export function BriefingShareButton({
  org,
  range,
  from,
  to,
  segment,
  stack,
}: {
  org: string;
  range: string;
  from?: string;
  to?: string;
  // EXEC #1: the active per-client segment scope, carried into the signed token so the shared
  // read-only board page re-runs the briefing scoped to the same client, not the whole org.
  segment?: string | null;
  // Feature 3b: the active tech-stack group key, carried so a "Frontend briefing" share stays scoped.
  stack?: string | null;
}) {
  const [state, setState] = useState<"idle" | "working" | "copied" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function share() {
    setState("working");
    setMsg(null);
    try {
      const res = await fetch("/api/org/briefing/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, range, from, to, segment: segment ?? undefined, stack: stack ?? undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Couldn't create a share link.");
      await navigator.clipboard?.writeText(`${window.location.origin}${d.path}`).catch(() => {});
      setState("copied");
      setMsg("Read-only link copied — valid 14 days.");
      setTimeout(() => setState((s) => (s === "copied" ? "idle" : s)), 4000);
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "Failed to create a link.");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={share}
        disabled={state === "working"}
        className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
        title="Create a read-only link a board member can open without an account"
      >
        <span aria-hidden>↗</span> {state === "copied" ? "Link copied" : state === "working" ? "Creating…" : "Share read-only link"}
      </button>
      {msg && <span className={`font-mono text-sm ${state === "error" ? "text-orange-300" : "text-emerald-300"}`}>{msg}</span>}
    </span>
  );
}
