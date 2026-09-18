"use client";

// The observatory's three pieces of view state, each a thin hook over a pure module:
//   useSkyMemory — folds every NEW pulse into what this screen has seen (skyMemory.ts);
//   useSkySize   — the hero's measured box, so the viewBox matches its aspect and the sky is full-bleed;
//   useSkyDrift  — when a repo changes ring (won a slot, finished, paused), the one glide that says so.
// All three use React's "adjust state while rendering" pattern or a subscription callback — no ref is
// read during render and no state is set synchronously inside an effect.

import { useCallback, useState } from "react";
import type { LoopPulse } from "@/lib/local/runner-types";
import { driftPoint } from "../../../observatory/observatoryGeometry";
import { useDriftProgress } from "../../../observatory/observatoryMotion";
import { emptyMemory, foldPulse, type SkyMemory } from "./skyMemory";
import { pointOn, type Pt, type SkyFrame } from "./skyEllipse";
import type { Seat } from "./skyLayout";

/** Fold the pulse into memory whenever a new pulse object arrives. The first fold is history. */
export function useSkyMemory(pulse: LoopPulse, now: number): SkyMemory {
  const [mem, setMem] = useState<SkyMemory>(() => foldPulse(emptyMemory(now), pulse, now));
  if (mem.pulse !== pulse) {
    const next = foldPulse(mem, pulse, now);
    setMem(next);
    return next;
  }
  return mem;
}

export interface BoxSize {
  w: number;
  h: number;
}

/** A callback ref that measures its element (React 19 ref cleanup disconnects the observer). */
export function useSkySize(): [(el: HTMLElement | null) => (() => void) | undefined, BoxSize | null] {
  const [size, setSize] = useState<BoxSize | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r || r.width <= 0 || r.height <= 0) return;
      const next = { w: Math.round(r.width), h: Math.round(r.height) };
      setSize((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Seats as a comparable string — rounded so float noise is never "a change". */
export function seatSignature(seats: ReadonlyMap<string, Seat>): string {
  return [...seats]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([repo, s]) => `${repo}:${s.ring}:${Math.round(s.deg)}`)
    .join("|");
}

export interface SkyDrift {
  /** Where a body sits at this frame of the glide (its seat when nothing is gliding). */
  at: (repo: string, seat: Seat) => Pt;
  /** True while a glide is in flight — the renderer uses it to hold back label changes. */
  moving: boolean;
}

/**
 * The ring-change glide. Mount is never a glide (the sky appears settled); a later change of seats
 * glides every moved body from its previous seat along the cockpit observatory's own drift arc
 * (`driftPoint`, `useDriftProgress` — the same curve and duration). Reduced motion: no glide at all,
 * bodies are simply at their new seats.
 */
export function useSkyDrift(seats: ReadonlyMap<string, Seat>, f: SkyFrame, reduced: boolean): SkyDrift {
  const sig = seatSignature(seats);
  const [st, setSt] = useState<{ sig: string; prev: ReadonlyMap<string, Seat> | null; cur: ReadonlyMap<string, Seat> }>(() => ({
    sig,
    prev: null,
    cur: seats,
  }));
  let state = st;
  if (st.sig !== sig) {
    state = { sig, prev: st.cur, cur: seats };
    setSt(state);
  }
  const p = useDriftProgress(reduced || state.prev === null ? null : state.sig);
  const prev = state.prev;
  return {
    moving: p < 1,
    at: (repo, seat) => {
      const to = pointOn(f, seat.ring, seat.deg);
      const was = prev?.get(repo);
      if (p >= 1 || !was || (was.ring === seat.ring && Math.round(was.deg) === Math.round(seat.deg))) return to;
      return driftPoint(pointOn(f, was.ring, was.deg), to, p);
    },
  };
}
