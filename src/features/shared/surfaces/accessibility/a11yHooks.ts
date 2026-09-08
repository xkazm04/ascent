"use client";

// The scene's announcer — live-region-architecture as one hook the whole desk calls. ONE provider
// (the Scene owns it; every region announces through it and none mounts a region of its own), two
// persistent homes (polite / assertive — rendered by AnnouncerRegion from the FIRST render, so the
// region exists before the news), a drain queue that serializes bursts one utterance per tick,
// assertive preempting queued polite without erasing it, and a keyed remount so an identical repeat
// is a genuine mutation. Every scheduled drain names its reaper (the effect cleanup clears it).
// Written against the React Compiler rules: no ref is read during render, no synchronous setState in
// an effect body — the drain fires from a timer.

import { useCallback, useEffect, useRef, useState } from "react";

export type Politeness = "polite" | "assertive";
export type Utterance = { id: number; text: string; politeness: Politeness };

export const DRAIN_SPACING_MS = 150;
export const QUEUE_BOUND = 6;

export type Announcer = ReturnType<typeof useAnnouncer>;

export function useAnnouncer(spacingMs = DRAIN_SPACING_MS) {
  const seq = useRef(0);
  const [queue, setQueue] = useState<Utterance[]>([]);
  const [live, setLive] = useState<Record<Politeness, Utterance | null>>({ polite: null, assertive: null });
  const [log, setLog] = useState<Utterance[]>([]);
  const [shed, setShed] = useState(0);

  /** Called on EVENTS (something happened), never from a render path. */
  const announce = useCallback((text: string, politeness: Politeness = "polite") => {
    seq.current += 1;
    const u: Utterance = { id: seq.current, text, politeness };
    setQueue((q) => {
      // Assertive jumps ahead of queued polite messages; the polite backlog resumes after.
      const at = politeness === "assertive" ? q.findIndex((x) => x.politeness === "polite") : -1;
      const next = at === -1 ? [...q, u] : [...q.slice(0, at), u, ...q.slice(at)];
      if (next.length <= QUEUE_BOUND) return next;
      // Bounded: shed the OLDEST polite message rather than replay a backlog at a user who moved on.
      const drop = next.findIndex((x) => x.politeness === "polite");
      setShed((n) => n + 1);
      return drop === -1 ? next.slice(1) : [...next.slice(0, drop), ...next.slice(drop + 1)];
    });
  }, []);

  // The drain: one utterance per tick. The timer is created here and destroyed here — cleared on
  // every queue change and on unmount, so a disposed scene never speaks into a torn-down document.
  useEffect(() => {
    const head = queue[0];
    if (!head) return;
    const id = setTimeout(() => {
      setQueue((q) => q.slice(1));
      setLive((l) => ({ ...l, [head.politeness]: head }));
      setLog((l) => [...l, head].slice(-8));
    }, spacingMs);
    return () => clearTimeout(id);
  }, [queue, spacingMs]);

  return { announce, queue, live, log, shed, voiced: log.length };
}
