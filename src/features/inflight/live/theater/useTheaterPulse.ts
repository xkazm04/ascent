"use client";

// THE THEATER'S TRANSPORT — one pulse read every `THEATER_PULSE_MS` while the page is visible.
//
// NON-OVERLAPPING: a `setTimeout` chain whose next tick is armed only after the current read settles,
// so a slow response delays the next tick instead of racing a second read beside it (an interval does
// not wait). Hidden tab → the chain is torn down and nothing polls; visible again → an immediate tick.
// A failed read backs off (2 s → 4 s → 8 s → 15 s) and a good one resets the cadence.
//
// STALENESS is the page's, not the server's: `receivedAt` is THIS browser's clock at the last good
// read, so a skewed server clock cannot make a live runner look dead or a dead one look live.
// `feedStale` says "stale" once the last good read is older than `THEATER_STALE_MS`.
//
// ARRIVALS: every read after the baseline (the first non-null pulse) hands its NEW `latest` events to
// `onArrivals` — from this callback, never from an effect — and records their keys in `arrivedKeys`
// for the rail's one-shot entrance. The baseline itself arrives as history, so a reload replays nothing.

import { useEffect, useRef, useState } from "react";
import { THEATER_PULSE_MS, type LoopPulse, type PulseEvent } from "@/lib/local/runner-types";
import { useIsVisible } from "../useIsVisible";
import { diffArrivals, eventKey, parsePulseResponse } from "./theaterPulseParse";
import { THEATER_STALE_MS } from "./theaterFormat";

export interface TheaterFeed {
  /** The last GOOD pulse (kept while stale — the page labels it, it does not discard it). */
  pulse: LoopPulse | null;
  loaded: boolean;
  receivedAt: number | null;
  /** When the transport first started listening — what "stale" counts from before the first answer. */
  listeningSince: number | null;
  /** The clock the page renders against (1 s resolution while visible). */
  now: number;
  error: string | null;
  arrivedKeys: ReadonlySet<string>;
}

/** Stale = the last good pulse is older than `THEATER_STALE_MS`; before the first one, = listening that
 *  long without an answer. No grace after a tab return: the render clock stays frozen until the
 *  return's immediate read lands (fresh at once) or the clock's next second shows it did not. */
export function feedStale(feed: Pick<TheaterFeed, "receivedAt" | "listeningSince" | "now">): boolean {
  if (feed.receivedAt != null) return feed.now - feed.receivedAt > THEATER_STALE_MS;
  return feed.listeningSince != null && feed.now - feed.listeningSince > THEATER_STALE_MS;
}

const ARRIVED_MAX = 200;
export function mergeArrived(prev: ReadonlySet<string>, events: readonly PulseEvent[]): ReadonlySet<string> {
  const next = new Set(prev);
  for (const e of events) next.add(eventKey(e));
  while (next.size > ARRIVED_MAX) next.delete(next.values().next().value as string);
  return next;
}

export function failureText(status: number, body: unknown): string {
  const said = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : null;
  if (said) return said;
  if (status === 401) return "Signed out — sign in again to resume";
  if (status === 403) return "No access to this organization";
  return `The server answered ${status}`;
}

const UNREADABLE = Symbol("unreadable");
const backoff = (failures: number, base: number) => Math.min(15_000, base * 2 ** Math.min(failures, 3));

export interface TheaterPulseOptions {
  intervalMs?: number;
  onArrivals?: (events: PulseEvent[]) => void;
  fetchImpl?: typeof fetch;
}

export function useTheaterPulse(url: string | null, opts: TheaterPulseOptions = {}): TheaterFeed {
  const { intervalMs = THEATER_PULSE_MS, onArrivals, fetchImpl } = opts;
  const visible = useIsVisible();
  const [now, setNow] = useState(() => Date.now());
  const [state, setState] = useState<Omit<TheaterFeed, "now">>({
    pulse: null,
    loaded: false,
    receivedAt: null,
    listeningSince: null,
    error: null,
    arrivedKeys: new Set<string>(),
  });
  const onArrivalsRef = useRef(onArrivals);
  useEffect(() => {
    onArrivalsRef.current = onArrivals;
  }, [onArrivals]);
  const seenRef = useRef<Set<string>>(new Set());
  const baselineRef = useRef(false);

  // The render clock: ticks while visible, frozen while hidden (nothing on screen to update).
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [visible]);

  useEffect(() => {
    if (!url || !visible) return;
    const doFetch = fetchImpl ?? fetch;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ctrl: AbortController | null = null;
    let failures = 0;

    const apply = (pulse: LoopPulse | null) => {
      const at = Date.now();
      let arrivals: PulseEvent[] = [];
      if (pulse) {
        const diff = diffArrivals(seenRef.current, pulse.latest, !baselineRef.current);
        seenRef.current = diff.seen;
        baselineRef.current = true;
        arrivals = diff.arrivals;
      }
      setNow(at);
      setState((s) => ({
        ...s,
        pulse,
        loaded: true,
        receivedAt: at,
        error: null,
        arrivedKeys: arrivals.length ? mergeArrived(s.arrivedKeys, arrivals) : s.arrivedKeys,
      }));
      if (arrivals.length) onArrivalsRef.current?.(arrivals);
    };

    const tick = async () => {
      if (cancelled) return;
      ctrl = new AbortController();
      let ok = false;
      try {
        const res = await doFetch(url, { cache: "no-store", signal: ctrl.signal });
        const body: unknown = await res.json().catch(() => UNREADABLE);
        if (cancelled) return;
        const parsed = res.ok ? parsePulseResponse(body) : ({ ok: false } as const);
        if (parsed.ok) {
          ok = true;
          apply(parsed.pulse);
        } else {
          const error = res.ok ? "The server answered something unreadable" : failureText(res.status, body);
          setState((s) => ({ ...s, error }));
        }
      } catch {
        if (cancelled) return;
        setState((s) => ({ ...s, error: "Network error — the server did not answer" }));
      }
      if (cancelled) return;
      failures = ok ? 0 : failures + 1;
      timer = setTimeout(() => void tick(), ok ? intervalMs : backoff(failures, intervalMs));
    };

    timer = setTimeout(() => {
      const at = Date.now();
      setState((s) => (s.listeningSince == null ? { ...s, listeningSince: at } : s));
      void tick();
    }, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      ctrl?.abort();
    };
  }, [url, visible, intervalMs, fetchImpl]);

  return { ...state, now };
}
