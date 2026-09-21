"use client";

// The cue lane: arrivals in, at most one card (and tone) per `CUE_GAP_MS` out — the budget itself is
// theaterCues.ts. This hook owns only the timers: the one pending "next cue" timer and each card's
// expiry, all cleared on unmount so nothing outlives the page.
//
// The controller is a plain closure created once (useState initializer), not a web of refs, so the
// transport can call `push` from its own fetch callback and nothing here reads a ref during render.

import { useEffect, useState } from "react";
import { CELEBRATION_MS } from "@/components/org/shared/liveWarRoomShared";
import type { PulseEvent } from "@/lib/local/runner-types";
import { cueDelay, emptyCueQueue, enqueueCues, takeCue, type CueKind, type TheaterCue } from "./theaterCues";
import { playCue } from "./theaterSound";

/** Cards on screen at once. A second only appears when a cue lands while the last is still fading. */
const CARDS_MAX = 2;

export interface CueController {
  push: (events: readonly PulseEvent[]) => void;
  setSound: (on: boolean) => void;
  dispose: () => void;
}

export function createCueController(
  show: (cue: TheaterCue) => void,
  hide: (id: string) => void,
  play: (kind: CueKind) => void = playCue,
  clock: () => number = Date.now,
): CueController {
  let queue = emptyCueQueue();
  let next: ReturnType<typeof setTimeout> | null = null;
  const expiries = new Set<ReturnType<typeof setTimeout>>();
  let sound = false;

  const pump = (): void => {
    if (next) return;
    const delay = cueDelay(queue, clock());
    if (delay == null) return;
    next = setTimeout(() => {
      next = null;
      const taken = takeCue(queue, clock());
      queue = taken.queue;
      if (taken.cue) {
        const cue = taken.cue;
        show(cue);
        if (sound) play(cue.kind);
        const ex = setTimeout(() => {
          expiries.delete(ex);
          hide(cue.id);
        }, CELEBRATION_MS);
        expiries.add(ex);
      }
      pump();
    }, delay);
  };

  return {
    push(events) {
      queue = enqueueCues(queue, events);
      pump();
    },
    setSound(on) {
      sound = on;
    },
    dispose() {
      if (next) clearTimeout(next);
      next = null;
      for (const t of expiries) clearTimeout(t);
      expiries.clear();
      queue = { ...queue, pending: [] };
    },
  };
}

export function useTheaterCues(soundOn: boolean): { cards: TheaterCue[]; push: (events: readonly PulseEvent[]) => void } {
  const [cards, setCards] = useState<TheaterCue[]>([]);
  const [ctl] = useState(() =>
    createCueController(
      (cue) => setCards((cs) => [...cs, cue].slice(-CARDS_MAX)),
      (id) => setCards((cs) => cs.filter((c) => c.id !== id)),
    ),
  );
  useEffect(() => {
    ctl.setSound(soundOn);
  }, [ctl, soundOn]);
  useEffect(() => () => ctl.dispose(), [ctl]);
  return { cards, push: ctl.push };
}
