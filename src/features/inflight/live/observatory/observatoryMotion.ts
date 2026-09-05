"use client";

// Observatory motion — the ONE tween the field runs (the outcome drift) plus the colour lerp it
// needs. Same reduced-motion contract as useLiveWarRoomStat.ts's `useTween`: the media query is read
// inside the effect, and when it matches the animation is short-circuited to its END STATE rather
// than skipped. There is no idle loop here; the scanning pulse is a CSS class the field applies only
// while `scanning` is non-empty.

import { useEffect, useRef, useState } from "react";
import { rgbOf } from "@/lib/ui";
import { driftPoint, type Pt } from "./observatoryGeometry";
import type { ObservatoryBody, PlottedBody } from "./observatoryModel";

/** Upper bound on the drift, per the brand's "motion is a beat" rule. */
export const DRIFT_MS = 900;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Play a one-shot 0→1 ease-out whenever `key` changes. Under prefers-reduced-motion it stays at 1,
 * so callers render the end state with no intermediate frames.
 */
export function useDriftProgress(key: string | null, ms = DRIFT_MS): number {
  const [p, setP] = useState(1);
  // React's documented "adjust state when a prop changes" pattern (a previous-value STATE, not a ref,
  // which is what keeps it legal during render): a new key rewinds the tween before paint, so bodies
  // never flash their end position for a frame first. Mount is deliberately never a drift, so the
  // server render and the first client render agree.
  const [prevKey, setPrevKey] = useState<string | null>(key);
  const raf = useRef(0);
  if (prevKey !== key) {
    setPrevKey(key);
    setP(key && !prefersReducedMotion() ? 0 : 1);
  }
  useEffect(() => {
    // Reduced motion: nothing is scheduled and `p` is already 1 — the caller renders the end state.
    if (!key || prefersReducedMotion()) return;
    let start = 0;
    const step = (t: number) => {
      if (!start) start = t;
      const q = Math.min(1, (t - start) / ms);
      setP(1 - Math.pow(1 - q, 3));
      if (q < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [key, ms]);
  return p;
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

/** Blend two brand hexes. Only ever fed LEVEL_HEX/scoreHex values, so the ramp stays the ramp. */
export function lerpHex(from: string, to: string, t: number): string {
  const a = rgbOf(from);
  const b = rgbOf(to);
  const c = a.map((v, i) => v + (b[i]! - v) * Math.max(0, Math.min(1, t))) as [number, number, number];
  return `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
}

export interface DriftFrame {
  body: PlottedBody;
  at: Pt;
  fill: string;
  /** True once the body has crossed into the AI-Native quadrant during THIS drift — one ring pulse. */
  crossed: boolean;
}

/**
 * Interpolate the `after` bodies back toward their `before` positions at progress `p`. A body with no
 * `before` twin (a first-ever scan) simply appears at its final place — there is no prior position to
 * glide from and inventing one would be a lie about movement.
 */
export function driftFrames(
  before: readonly ObservatoryBody[],
  after: readonly PlottedBody[],
  p: number,
): DriftFrame[] {
  const prior = new Map(before.map((b) => [b.fullName, b]));
  return after.map((body) => {
    const was = prior.get(body.fullName);
    if (!was || was.x == null || was.y == null) return { body, at: { x: body.x, y: body.y }, fill: body.fill, crossed: false };
    return {
      body,
      at: driftPoint({ x: was.x, y: was.y }, { x: body.x, y: body.y }, p),
      fill: lerpHex(was.fill, body.fill, p),
      crossed: was.quadrant !== "compounding" && body.quadrant === "compounding",
    };
  });
}
