"use client";

// The drawer's data feed: the server-derived getting-started payload, polled while the drawer is on
// screen, plus the two stamp writes.
//
// Polling is the whole point of the derived model. Nothing is recorded per step, so a scan finishing
// in another tab, a rec assigned from the backlog, or a teammate accepting an invite all show up on
// the next read — the member never has to know the drawer exists for it to stay true. 20s is slow
// enough to be free (the route is a handful of existence-shaped lookups) and fast enough that an
// in-flight scan flips its row while the member is still looking at it.

import { useCallback, useEffect, useRef, useState } from "react";
import type { GettingStartedPayload } from "./tasks";

export const GETTING_STARTED_POLL_MS = 20_000;

export interface GettingStartedFeed {
  payload: GettingStartedPayload | null;
  /** True once the first response (or its failure) has settled — the posture decision waits for it. */
  loaded: boolean;
  refresh: () => void;
}

/**
 * Fetch + poll the checklist for `slug`. A failed read leaves the last good payload in place and
 * degrades to the teaching posture rather than blanking the drawer: guidance chrome must never be the
 * thing that breaks a dashboard.
 */
export function useGettingStarted(slug: string): GettingStartedFeed {
  const [payload, setPayload] = useState<GettingStartedPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/org/getting-started?org=${encodeURIComponent(slug)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as GettingStartedPayload;
        if (alive.current) setPayload(data);
      } catch {
        /* keep the last good payload — see the degrade note above */
      } finally {
        if (alive.current) setLoaded(true);
      }
    })();
    return () => controller.abort();
  }, [slug, tick]);

  useEffect(() => {
    const id = window.setInterval(() => {
      // A backgrounded tab polls nothing: the drawer is not visible, and the next foreground tick
      // catches up in full (the payload is a complete snapshot, never a delta).
      if (document.visibilityState !== "hidden") refresh();
    }, GETTING_STARTED_POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { payload, loaded, refresh };
}

/**
 * Write the caller's own onboarding stamp. Fire-and-forget by contract: the flow gate is a
 * convenience, and a failed stamp must never block the click that triggered it (the worst case is the
 * companion opening once more, which the next successful stamp settles).
 */
export function stampOnboarding(slug: string, status: "completed" | "skipped"): void {
  void fetch("/api/org/onboarding", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org: slug, status }),
  }).catch(() => {});
}
