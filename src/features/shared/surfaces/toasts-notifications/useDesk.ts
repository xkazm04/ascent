"use client";

// The desk's clock and store as one hook. ONE interval advances scene time by `tick` actions while the
// clock runs; every dwell, cooldown, drain gap and retention age is state derived from that time, so
// the interval is the only timer in the scene and its reaper is the effect's cleanup. Under `reduced`
// the clock starts paused (the stack's pause control is the visible governor); the buttons still work,
// and the announcer's manual step drains without a clock.

import { useEffect, useReducer, useState, type Dispatch } from "react";
import { type Action, type DeskState, initialDesk, reduce } from "./desk";

export const TICK_MS = 100;

export interface Desk {
  state: DeskState;
  dispatch: Dispatch<Action>;
  running: boolean;
  setRunning: (on: boolean) => void;
}

export function useDesk(fleet: string[], reduced: boolean): Desk {
  const [state, dispatch] = useReducer(reduce, fleet, initialDesk);
  const [running, setRunning] = useState(!reduced);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => dispatch({ type: "tick", dt: TICK_MS }), TICK_MS);
    return () => clearInterval(id); // the clock names its reaper
  }, [running]);
  return { state, dispatch, running, setRunning };
}
