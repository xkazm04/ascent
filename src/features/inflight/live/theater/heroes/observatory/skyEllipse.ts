// The sky's frame and its orbits — three concentric ellipses seen at one perspective tilt, and the
// arithmetic of walking along them. Pure geometry in viewBox units; no React, no pulse.
//
// Angles are DEGREES, counter-clockwise on screen (0 = the right end of a ring, 90 = its far/top
// edge). Every body "travels" counter-clockwise, so a comet tail trails CLOCKWISE behind its nucleus —
// the tail is drawn by walking the ring backwards by arc length, which keeps particle spacing even
// whether the tail runs along the ring's flat top or round around its end.

import { NARRATION_BAND, RING_RX, RING_TILT_MAX, SKY_VB_H_DEFAULT, SKY_VB_H_MAX, SKY_VB_H_MIN, SKY_VB_W } from "./skyConstants";

export interface Pt {
  x: number;
  y: number;
}

export interface SkyFrame {
  w: number;
  h: number;
  /** The sky proper (above the narration band). */
  skyH: number;
  cx: number;
  cy: number;
  rx: readonly [number, number, number];
  ry: readonly [number, number, number];
  /** Baseline of the narrated line. */
  narrationY: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Round to 0.1 user units. Trig can differ in the last digit between the server's and the browser's
 *  engine, and an SVG attribute that differs in the 14th decimal is a hydration mismatch. */
export const r1 = (v: number): number => Math.round(v * 10) / 10;

/** The frame for a hero measured `w × h` CSS px (or the 1080p default before it is measured). */
export function skyFrame(size: { w: number; h: number } | null): SkyFrame {
  const raw = size && size.w > 0 && size.h > 0 ? (SKY_VB_W * size.h) / size.w : SKY_VB_H_DEFAULT;
  const h = Math.round(Math.min(SKY_VB_H_MAX, Math.max(SKY_VB_H_MIN, raw)));
  const skyH = h - NARRATION_BAND;
  const tilt = Math.min(RING_TILT_MAX, (skyH / 2 - 26) / RING_RX[2]);
  const ry = RING_RX.map((r) => r1(r * tilt)) as unknown as [number, number, number];
  return { w: SKY_VB_W, h, skyH, cx: SKY_VB_W / 2, cy: r1(skyH / 2 + 4), rx: RING_RX, ry, narrationY: skyH + NARRATION_BAND / 2 + 10 };
}

export function pointOn(f: SkyFrame, ring: 0 | 1 | 2, deg: number): Pt {
  return { x: r1(f.cx + f.rx[ring] * Math.cos(rad(deg))), y: r1(f.cy - f.ry[ring] * Math.sin(rad(deg))) };
}

/** Unit normal pointing away from the centre at a ring point. */
export function outward(f: SkyFrame, ring: 0 | 1 | 2, deg: number): Pt {
  // Gradient of (x/rx)² + (y/ry)² at the point, in screen coordinates.
  const nx = Math.cos(rad(deg)) / f.rx[ring];
  const ny = -Math.sin(rad(deg)) / f.ry[ring];
  const len = Math.hypot(nx, ny) || 1;
  return { x: nx / len, y: ny / len };
}

const STEP_DEG = 0.5;
/** Math.sqrt is correctly rounded everywhere (Math.hypot is not) — the walk must agree server/client. */
const dist = (a: Pt, b: Pt) => Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));

/**
 * Points at the given arc distances BEHIND `deg` (clockwise), in order. `distances` must ascend.
 * Returns each point's angle too, so a caller can offset along the normal.
 */
export function walkBack(f: SkyFrame, ring: 0 | 1 | 2, deg: number, distances: readonly number[]): { at: Pt; deg: number }[] {
  const out: { at: Pt; deg: number }[] = [];
  let travelled = 0;
  let a = deg;
  let prev = pointOn(f, ring, a);
  for (const d of distances) {
    while (travelled < d && a > deg - 360) {
      const next = pointOn(f, ring, a - STEP_DEG);
      travelled += dist(prev, next);
      prev = next;
      a -= STEP_DEG;
    }
    out.push({ at: prev, deg: a });
  }
  return out;
}

/** Arc length walking clockwise from `from` to `to` (degrees; `to` behind `from`). */
export function arcBack(f: SkyFrame, ring: 0 | 1 | 2, from: number, to: number): number {
  let span = (((from - to) % 360) + 360) % 360;
  if (span === 0) span = 360;
  let len = 0;
  let prev = pointOn(f, ring, from);
  for (let a = STEP_DEG; a <= span; a += STEP_DEG) {
    const next = pointOn(f, ring, from - a);
    len += dist(prev, next);
    prev = next;
  }
  return len;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: Box, b: Box, pad = 0): boolean =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

export const inside = (p: Pt, b: Box, pad = 0): boolean => p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;

/** FNV-1a over the string, as a number in [0, 1) — the stable seat a repo's name buys it. */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}
