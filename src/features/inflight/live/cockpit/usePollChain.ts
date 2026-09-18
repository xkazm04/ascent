"use client";

// THE POLL AS A CHAIN, not an interval. An interval does not wait: a read slower than its cadence had
// the next one start beside it. Here the next tick is armed only after the current one SETTLES, so a
// slow response delays the poll rather than stacking requests — and the ticker (`serialTick.ts`)
// guarantees the chain's reads and an action's never overlap either.
//
// The first tick is due one cadence after the last read settled: at once on mount, or on a tab coming
// back overdue; NOT again immediately when the read that changed the cadence has only just landed
// (re-arming used to fire a duplicate read on every start). `cadenceMs: null` arms nothing — that is
// how a hidden tab costs exactly zero. Every tick is scheduled from a callback, so the effect body
// never sets state synchronously.

import { useEffect, useMemo } from "react";
import { serialTicker, type SerialTicker } from "./serialTick";

/**
 * Serialize `read` (one ticker per `read` identity — pass a stable callback) and poll it on a chain at
 * `cadenceMs`. Returns the ticker, whose `run` is how an ACTION asks for a read without ever starting
 * one beside the chain's.
 */
export function usePollChain(read: () => Promise<void>, cadenceMs: number | null): SerialTicker {
  const ticker = useMemo(() => serialTicker(read), [read]);
  useEffect(() => {
    if (cadenceMs == null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      void ticker.run().then(() => {
        if (!cancelled) timer = setTimeout(step, cadenceMs);
      });
    };
    timer = setTimeout(step, Math.max(0, cadenceMs - (Date.now() - ticker.lastAt())));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ticker, cadenceMs]);
  return ticker;
}
