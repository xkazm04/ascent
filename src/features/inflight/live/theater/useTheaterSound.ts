"use client";

// Sound on the theater: off, ARMED (wanted — `?sound=1` — but the browser has not been given a gesture
// yet), or on. Armed is said out loud in the UI ("click anywhere to turn sound on") because a screen
// that silently cannot play what it promised is the failure this state exists to prevent.
//
// The first pointer or key press anywhere unlocks audio inside that gesture (theaterSound.ts). A
// press on the sound toggle itself is left to the toggle, so arming and clicking it cannot cancel out.

import { useCallback, useEffect, useState } from "react";
import { lockAudio, unlockAudio } from "./theaterSound";

export type SoundMode = "off" | "armed" | "on";

export const SOUND_TOGGLE_ATTR = "data-sound-toggle";

export function useTheaterSound(preselect: boolean): { mode: SoundMode; toggle: () => void } {
  const [mode, setMode] = useState<SoundMode>(preselect ? "armed" : "off");

  useEffect(() => {
    if (mode !== "armed") return;
    const onGesture = (e: Event) => {
      const t = e.target as Element | null;
      if (t && typeof t.closest === "function" && t.closest(`[${SOUND_TOGGLE_ATTR}]`)) return;
      setMode(unlockAudio() ? "on" : "off");
    };
    document.addEventListener("pointerdown", onGesture);
    document.addEventListener("keydown", onGesture);
    return () => {
      document.removeEventListener("pointerdown", onGesture);
      document.removeEventListener("keydown", onGesture);
    };
  }, [mode]);

  // Nothing audible may outlive the page.
  useEffect(() => () => lockAudio(), []);

  const toggle = useCallback(() => {
    if (mode === "on") {
      lockAudio();
      setMode("off");
    } else {
      setMode(unlockAudio() ? "on" : "off");
    }
  }, [mode]);

  return { mode, toggle };
}
