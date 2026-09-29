"use client";

// Small browser-state hooks for the Prism landing. Both are external-store subscriptions with a server
// snapshot, so the server render and the first client render agree and React corrects after hydration.

import { useMemo, useSyncExternalStore } from "react";
import { parseHash, type PrismRoute } from "./prismModel";

const RM_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(cb: () => void): () => void {
  const mq = window.matchMedia?.(RM_QUERY);
  mq?.addEventListener("change", cb);
  return () => mq?.removeEventListener("change", cb);
}

/** Live `prefers-reduced-motion: reduce`. Server and first paint say false. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia?.(RM_QUERY).matches ?? false,
    () => false,
  );
}

function subscribeHash(cb: () => void): () => void {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

/** The raw location hash; "" on the server. */
function useHash(): string {
  return useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
}

/** The scene the URL names (`#/line/D3`, `#/line/D3/2`), or null when the URL is the plain page. */
export function usePrismRoute(): PrismRoute | null {
  const hash = useHash();
  return useMemo(() => parseHash(hash), [hash]);
}
