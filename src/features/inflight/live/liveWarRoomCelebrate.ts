"use client";

// The war-room's celebration lane, split out of useLiveWarRoom.ts for the 200-LOC src/features cap.
// Owns the transient celebration cards, their expiry timers, and WARROOM-5's opt-in (default-off)
// chime + its persisted toggle. Keeps its own timer set so a pending expiry can't outlive the wall.

import { useCallback, useEffect, useRef, useState } from "react";
import { CELEBRATION_MAX, CELEBRATION_MS, type Celebration } from "@/components/org/shared/liveWarRoomShared";

export function useLiveWarRoomCelebrations() {
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  // WARROOM-5: opt-in (default-off) celebration sound. Read via a ref in pushCelebration so the
  // (stable) callback always sees the latest value without re-creating.
  const [sound, setSound] = useState(false);
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Tear down pending celebration timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // A short synthesized "ta-da" (no bundled asset). Gated on the opt-in Sound toggle + reduced-motion;
  // the Launch click satisfies the browser's autoplay gesture requirement. Best-effort — never throws.
  const playChime = useCallback(() => {
    if (!soundRef.current || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    try {
      const ctx = new Ctx();
      const start = ctx.currentTime;
      for (const [freq, at] of [[880, 0], [1175, 0.12]] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start + at);
        gain.gain.exponentialRampToValueAtTime(0.15, start + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start + at);
        osc.stop(start + at + 0.3);
      }
      const closer = setTimeout(() => void ctx.close().catch(() => {}), 600);
      timersRef.current.add(closer);
    } catch {
      /* audio unavailable / blocked — celebrations stay visual-only */
    }
  }, []);

  const pushCelebration = useCallback(
    (c: Celebration) => {
      setCelebrations((cs) => [...cs, c].slice(-CELEBRATION_MAX));
      playChime();
      const timer = setTimeout(() => {
        setCelebrations((cs) => cs.filter((x) => x.id !== c.id));
        timersRef.current.delete(timer);
      }, CELEBRATION_MS);
      timersRef.current.add(timer);
    },
    [playChime],
  );

  // WARROOM-5: restore + persist the Sound toggle.
  useEffect(() => {
    let persisted = false;
    try {
      persisted = localStorage.getItem("ascent-warroom-sound") === "1";
    } catch {
      /* localStorage unavailable */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot restore of the persisted toggle
    if (persisted) setSound(true);
  }, []);
  const toggleSound = useCallback(() => {
    setSound((v) => {
      const nv = !v;
      try {
        localStorage.setItem("ascent-warroom-sound", nv ? "1" : "0");
      } catch {
        /* localStorage unavailable */
      }
      return nv;
    });
  }, []);

  return { celebrations, setCelebrations, sound, toggleSound, pushCelebration };
}
