"use client";

// Follows ONE Polar checkout after the buyer returns: asks /api/billing/checkout/status with backoff
// (pollDelayMs: 2s, 4s, 8s, capped at 15s) until a terminal state, then stops. On "landed" it calls
// router.refresh() exactly once so the server-rendered credits and plan chips repaint with what arrived.
// No checkout id (a bookmarked or legacy ?credits=pending link) is "unverified" at once: nothing to ask.
// A 4xx (unknown / refused checkout) is also unverified and final; a 5xx or network error keeps the
// current state and retries on the next tick. Imports only the pure model, never server code.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  isTerminalCheckoutReturn,
  pollDelayMs,
  type CheckoutReturnView,
} from "@/lib/billing/checkoutReturnModel";

const CHECKING: CheckoutReturnView = { state: "confirming" };
const UNVERIFIED: CheckoutReturnView = { state: "unverified" };

async function ask(org: string, checkoutId: string): Promise<CheckoutReturnView | null> {
  try {
    const qs = new URLSearchParams({ org, checkout_id: checkoutId });
    const res = await fetch(`/api/billing/checkout/status?${qs.toString()}`, { cache: "no-store" });
    if (res.ok) return (await res.json()) as CheckoutReturnView;
    return res.status >= 400 && res.status < 500 ? UNVERIFIED : null;
  } catch {
    return null; // network blip: retry on the next tick
  }
}

export function useCheckoutReturn(org: string, checkoutId: string | null): CheckoutReturnView {
  const router = useRouter();
  const [view, setView] = useState<CheckoutReturnView>(checkoutId ? CHECKING : UNVERIFIED);
  const refreshed = useRef(false);
  // The router is read through a ref so a fresh router object never restarts the poll loop.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    if (!checkoutId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const tick = async () => {
      const next = await ask(org, checkoutId);
      if (cancelled) return;
      if (next) setView(next);
      if (next && isTerminalCheckoutReturn(next.state)) {
        if (next.state === "landed" && !refreshed.current) {
          refreshed.current = true;
          routerRef.current.refresh();
        }
        return;
      }
      timer = setTimeout(tick, pollDelayMs(attempt++));
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [org, checkoutId]);

  return view;
}
