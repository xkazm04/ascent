"use client";

// `?demo=1` — the theater fed by the FIXTURE on a deterministic simulated clock, no fetch at all.
//
// The simulated clock starts at `DEMO_EPOCH + startAtS` and advances one second per real second while
// the page is visible (paused while hidden, like the live transport). The pulse is re-sampled on the
// same `THEATER_PULSE_MS` grid the live transport reads on, so the demo moves at the live cadence.
// Same `TheaterFeed` shape as `useTheaterPulse`, with the same arrival rules — the celebrations and the
// rail's entrances fire in the demo exactly as they would live, which is what the prototype round
// needs to judge a hero. Never stale: a simulated server always answers.

import { useEffect, useMemo, useRef, useState } from "react";
import { THEATER_PULSE_MS, type PulseEvent } from "@/lib/local/runner-types";
import { useIsVisible } from "../useIsVisible";
import { DEMO_EPOCH, fixturePulseAt, type DemoScenario } from "./theaterFixture";
import { diffArrivals } from "./theaterPulseParse";
import { mergeArrived, type TheaterFeed } from "./useTheaterPulse";

/** The pulse the demo shows at simulated instant `simMs`: sampled on the live read grid. */
export function demoPulseAt(simMs: number, scenario: DemoScenario) {
  const offset = (((simMs - DEMO_EPOCH) % THEATER_PULSE_MS) + THEATER_PULSE_MS) % THEATER_PULSE_MS;
  return fixturePulseAt(simMs - offset, scenario);
}

export function useTheaterDemo(
  scenario: DemoScenario,
  opts: { startAtS?: number; onArrivals?: (events: PulseEvent[]) => void } = {},
): TheaterFeed {
  const { startAtS = 0, onArrivals } = opts;
  const visible = useIsVisible();
  const [simMs, setSimMs] = useState(() => DEMO_EPOCH + Math.max(0, startAtS) * 1000);
  const [arrivedKeys, setArrivedKeys] = useState<ReadonlySet<string>>(() => new Set<string>());
  const simRef = useRef(simMs);
  const seenRef = useRef<Set<string> | null>(null);
  const onArrivalsRef = useRef(onArrivals);
  useEffect(() => {
    onArrivalsRef.current = onArrivals;
  }, [onArrivals]);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      // Baseline on the first advance: what the page first showed is history, not an arrival.
      seenRef.current ??= diffArrivals(new Set(), demoPulseAt(simRef.current, scenario).latest, true).seen;
      const next = simRef.current + 1_000;
      simRef.current = next;
      const diff = diffArrivals(seenRef.current, demoPulseAt(next, scenario).latest, false);
      seenRef.current = diff.seen;
      setSimMs(next);
      if (diff.arrivals.length) {
        setArrivedKeys((prev) => mergeArrived(prev, diff.arrivals));
        onArrivalsRef.current?.(diff.arrivals);
      }
    }, 1_000);
    return () => clearInterval(id);
  }, [visible, scenario]);

  const pulse = useMemo(() => demoPulseAt(simMs, scenario), [simMs, scenario]);
  return { pulse, loaded: true, receivedAt: simMs, listeningSince: simMs, now: simMs, error: null, arrivedKeys };
}
