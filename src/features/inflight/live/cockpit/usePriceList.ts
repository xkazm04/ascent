"use client";

// The price list's one read, shared by both compositions of the panel. Fetches once on mount (the run poll is
// armed only while a run is live, and a price list is a standing summary that should be there when the tab opens).
import { useEffect, useState } from "react";
import { fetchLoopPrices } from "./loopClient";
import type { RemediationPriceList } from "./loopTypes";

/** `loaded` is false until the read lands (or `initial` was given): nothing is said before then. */
export function usePriceList(slug: string, initial: RemediationPriceList | null = null) {
  const [prices, setPrices] = useState<RemediationPriceList | null>(initial);
  const [loaded, setLoaded] = useState(initial != null);
  useEffect(() => {
    if (initial != null) return;
    let alive = true;
    void fetchLoopPrices(slug)
      .then((p) => {
        if (alive) setPrices(p);
      })
      .catch(() => null)
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [slug, initial]);
  return { prices, loaded };
}
