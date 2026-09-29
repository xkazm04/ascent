// The "line floods the screen" beat: a soft bar in the line's own colour, laid along the fan, that grows to
// cover the viewport just before the scene fades in. Imperative on purpose: it is one 550 ms transition on
// an element React leaves alone.

import { hexA } from "./engine/glow";
import type { PrismEngine } from "./engine/engine";

export type FlashSpec = NonNullable<ReturnType<PrismEngine["flashSpec"]>>;

export const FLASH_MS = 380;

export function playFlash(el: HTMLElement, s: FlashSpec): void {
  const h = s.half * 2 + 6;
  el.style.transition = "none";
  el.style.width = `${s.length}px`;
  el.style.height = `${h}px`;
  el.style.left = `${s.cx - s.length / 2}px`;
  el.style.top = `${s.cy - s.half - 3}px`;
  el.style.background = `radial-gradient(ellipse at 50% 50%,#fff 0%,${s.hue} 35%,${hexA(s.hue, 0)} 70%)`;
  el.style.transform = `rotate(${s.angle}rad) scale(1,1)`;
  el.style.opacity = "0";
  el.getBoundingClientRect(); // commit the start state before transitioning
  el.style.transition = "transform .55s cubic-bezier(.6,0,.2,1),opacity .55s";
  const k = (Math.max(window.innerWidth, window.innerHeight) * 2.6) / h;
  el.style.transform = `rotate(${s.angle}rad) scale(2.6,${k})`;
  el.style.opacity = ".9";
  window.setTimeout(() => {
    el.style.transition = "opacity .6s";
    el.style.opacity = "0";
  }, 520);
}
