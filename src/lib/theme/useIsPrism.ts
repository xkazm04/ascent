"use client";

// Client read of the active theme for the few components whose DATA treatment (not just their paint) differs
// per look. `false` on the server and during hydration, so both renders agree, then the real value; it follows
// the `data-theme` attribute, so the header switch updates it without a reload. Prefer CSS for anything paint.
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

export function useIsPrism(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.theme === "prism",
    () => false,
  );
}
