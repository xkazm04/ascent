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
  const [state, setState] = useState<"idle" | "working" | "copied" | "manual" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  // The minted URL, rendered for manual copy when the clipboard write fails or is unavailable —
  // it is the one artifact this flow exists to hand over, so it must have a visible fallback
  // (executive-briefing 07-16 #2). Each mint is a live 7-day token; losing the URL forces a re-mint.
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  async function share() {
    setState("working");
    setMsg(null);
    setShareUrl(null);
    try {
      const res = await fetch("/api/org/briefing/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, range, from, to, segment: segment ?? undefined, stack: stack ?? undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Couldn't create a share link.");
      const url = `${window.location.origin}${d.path}`;
      // briefing-share #2: echo the REAL expiry the route returns (the single source of truth) instead of
      // a hardcoded "14 days" that silently lied once the TTL was halved to 7d — the link was dead on day 8.
      const exp = typeof d.expiresAt === "number" ? new Date(d.expiresAt) : null;
      const expNote = exp ? ` — expires ${exp.toLocaleDateString()}` : "";
      // Only claim "copied" when writeText actually RESOLVED. Clipboard writes routinely fail here:
      // Safari revokes transient user activation after the awaited fetch, permissions policy can deny,
      // and navigator.clipboard is undefined on non-secure origins. The old `?.…catch(() => {})`
      // swallowed all of that and reported "Link copied" over an empty clipboard, with the URL shown
      // nowhere else (executive-briefing 07-16 #2).
      let copied = false;
      try {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(url);
          copied = true;
        }
      } catch {
        // fall through to the manual-copy presentation below
      }
      if (copied) {
        setState("copied");
        setMsg(`Read-only link copied${expNote}.`);
        setTimeout(() => setState((s) => (s === "copied" ? "idle" : s)), 4000);
      } else {
        setState("manual");
        setShareUrl(url);
        setMsg(`Couldn't copy automatically — copy the link below${expNote}.`);
      }
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
      {msg && (
        <span className={`font-mono text-sm ${state === "error" ? "text-orange-300" : state === "manual" ? "text-amber-300" : "text-emerald-300"}`}>
          {msg}
        </span>
      )}
      {state === "manual" && shareUrl && (
        <input
          readOnly
          value={shareUrl}
          aria-label="Read-only briefing link — copy manually"
          onFocus={(e) => e.currentTarget.select()}
          className="w-72 max-w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-200"
        />
      )}
    </span>
  );
}
