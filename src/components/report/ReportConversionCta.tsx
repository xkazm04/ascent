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

export function ReportConversionCta({ repo }: { repo?: string }) {
  // null = unresolved; the card stays hidden until we know which side of the funnel the viewer is on,
  // so a signed-in viewer never momentarily sees the "sign in" copy (and vice versa).
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // Individual-tier exit: "idle" → "busy" → "tracked" (now a link into the workspace); errors show
  // the API's message (cap reached, not public) instead of failing silently.
  const [track, setTrack] = useState<"idle" | "busy" | "tracked">("idle");
  const [trackError, setTrackError] = useState<string | null>(null);

  async function trackRepo() {
    if (!repo || track !== "idle") return;
    setTrack("busy");
    setTrackError(null);
    try {
      const res = await fetch("/api/me/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, watched: true }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setTrackError(body.error ?? "Couldn't track the repo. Try again.");
        setTrack("idle");
        return;
      }
      setTrack("tracked");
    } catch {
      setTrackError("Network error. Try again.");
      setTrack("idle");
    }
  }

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
          {/* Individual-tier exit: a signed-in viewer can pull THIS repo into their personal
              workspace right here — the lens over the shared public corpus, so tracking is free and
              instant (a pointer row, not a re-scan). */}
          {signedIn && repo && (
            track === "tracked" ? (
              <Link
                href="/me"
                className="focus-ring inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 px-4 py-2.5 text-base text-emerald-300 transition hover:border-emerald-400 hover:text-emerald-200"
              >
                In your workspace <span aria-hidden>→</span>
              </Link>
            ) : (
              <button
                type="button"
                onClick={trackRepo}
                disabled={track === "busy"}
                className="focus-ring inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-base text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
              >
                {track === "busy" ? "Tracking…" : "Track this repo"}
              </button>
            )
          )}
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
      {trackError && (
        <p role="alert" className="relative mt-2 text-sm text-rose-400">
          {trackError}
        </p>
      )}
    </Surface>
  );
}
