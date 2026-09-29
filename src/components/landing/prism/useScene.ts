"use client";

// The scene's lifecycle, as the winning prototype ran it. The URL hash is the source of truth (see
// usePrismRoute); this turns "the route changed" into the visual states the stylesheet keys off:
//   active   the URL names a line (the hero pauses)
//   open     the overlay is visible (after the flash on a fresh open); the page behind goes inert
//   live     the content is faded in (it drops for a beat while one line swaps for another)
//   shownI   the line whose content is on screen (lags the route by the swap beat; kept after close so
//            the overlay fades out with its content)
// State that follows the route is derived while rendering; effects only schedule the timed beats.

import { useEffect, useRef, useState, type RefObject } from "react";
import { FLASH_MS, playFlash } from "./prismFlash";
import type { PrismEngine } from "./engine/engine";
import type { PrismRoute } from "./prismModel";

const SWAP_MS = 180;

export function useScene(
  route: PrismRoute | null,
  reduced: boolean,
  engineRef: RefObject<PrismEngine | null>,
  flashRef: RefObject<HTMLElement | null>,
) {
  const ri = route?.i ?? null;
  const active = ri != null;
  const [wasActive, setWasActive] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [faded, setFaded] = useState(false);

  // A fresh open shows the requested line at once; a close resets the visibility flags for the next open.
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setShown(ri);
    else {
      setRevealed(false);
      setFaded(false);
    }
  }

  const riRef = useRef(ri);
  useEffect(() => {
    riRef.current = ri;
  });

  // Fresh open: flash the line across the screen (when the hero is showing its lines), then reveal.
  useEffect(() => {
    if (!active) return;
    const timers: number[] = [];
    const reveal = () => {
      setRevealed(true);
      timers.push(requestAnimationFrame(() => setFaded(true)));
    };
    const spec = riRef.current != null ? engineRef.current?.flashSpec(riRef.current) ?? null : null;
    if (spec && flashRef.current) {
      playFlash(flashRef.current, spec);
      timers.push(window.setTimeout(reveal, FLASH_MS));
    } else timers.push(window.setTimeout(reveal, 0));
    return () => {
      timers.forEach((t) => {
        window.clearTimeout(t);
        cancelAnimationFrame(t);
      });
    };
  }, [active, engineRef, flashRef]);

  // Line to line: the content fades out (live drops as soon as the route moves), swaps, fades back in.
  useEffect(() => {
    if (ri == null || ri === shown) return;
    const t = window.setTimeout(() => setShown(ri), revealed && !reduced ? SWAP_MS : 0);
    return () => window.clearTimeout(t);
  }, [ri, shown, revealed, reduced]);

  return { active, open: active && revealed, live: active && revealed && faded && shown === ri, shownI: shown };
}
