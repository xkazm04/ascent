"use client";

// Shared bfcache-restore reset for the sign-in CTAs' `pending` state (github-oauth-session 07-16 #4).
// A sibling of buttonChrome.tsx (the CTAs' shared chrome) rather than part of it, because buttonChrome
// must stay importable from server components (LeaderboardTable uses GitHubMark) and this needs useEffect.

import { useEffect } from "react";

/**
 * Reset a sign-in CTA's `pending` state when the page is restored from the back/forward cache.
 * Both CTAs deliberately keep `pending` until navigation leaves the page — but if the user reaches
 * GitHub's consent screen and presses BACK, Safari/Firefox (and Chrome for same-site history) restore
 * the page from bfcache with its JS state intact: the button stayed disabled on the spinner
 * ("Redirecting to GitHub…", aria-busy forever) with no recovery short of a manual reload — which
 * nothing suggested. `pageshow` with `event.persisted` fires exactly on that restore, so the CTA
 * returns to
 * its idle, clickable state. Shared so the two wrappers can't drift.
 */
export function useResetPendingOnPageShow(setPending: (pending: boolean) => void): void {
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setPending(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [setPending]);
}
