"use client";

// The scene's one owner of the tier: the reducer in probe.ts plus the two things only React can
// hold — the product's own quality control, and the play loop that walks the scripted trace. The
// preference (the frame's `reduced` prop OR the control) is folded in BEFORE scheduling: a change
// re-creates the probe from scratch (adjust-state-during-render, no effect dispatch), which is a
// genuine teardown when a preference turns on and a FRESH budget — never a resumption — when it
// turns off. The play loop is an interval that dispatches `tick`; it starts paused under `reduced`
// (the probe does not exist then anyway) and stops itself once the probe settles.

import { useEffect, useReducer, useState } from "react";
import { initialProbe, probeReducer, type Preference, type ProbeAction, type ProbeState } from "./probe";

/** Real milliseconds between scripted windows while playing — the fixture's second, sped up. */
export const PLAY_TICK_MS = 700;

export function useProbe(reducedMotion: boolean) {
  const [preference, setPreference] = useState<Preference>("auto");
  const [state, dispatch] = useReducer(probeReducer, undefined, () => initialProbe(preference, reducedMotion));
  const [playing, setPlaying] = useState(false);

  // The short-circuit is live in both directions: any change to the preference inputs re-creates the
  // probe (or refuses to create it) before the next paint.
  const key = `${preference}:${reducedMotion}`;
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    dispatch({ type: "schedule", preference, reducedMotion });
    if (reducedMotion) setPlaying(false);
  }

  const active = playing && state.phase !== "settled" && state.phase !== "short-circuited";
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => dispatch({ type: "tick" }), PLAY_TICK_MS);
    return () => clearInterval(id); // creation names its reaper
  }, [active]);

  const reset = () => {
    setPlaying(false);
    dispatch({ type: "schedule", preference, reducedMotion });
  };

  return {
    state,
    dispatch: dispatch as (a: ProbeAction) => void,
    preference,
    setPreference,
    playing: active,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    reset,
  } as const;
}

export type Probe = ReturnType<typeof useProbe>;
export type { ProbeState };
