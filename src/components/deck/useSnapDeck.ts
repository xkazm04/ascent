"use client";

// Turns the page into a scroll-snap deck while mounted by toggling `snap-deck` on <html> (the rule
// lives in globals.css, scoped to that class, and is disabled under reduced-motion). Cleaning up on
// unmount means every other route keeps normal scrolling.

import { useEffect } from "react";

export function useSnapDeck() {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("snap-deck");
    return () => html.classList.remove("snap-deck");
  }, []);
}
