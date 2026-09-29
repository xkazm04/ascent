// Off-screen glow layers, dust and the small drawing helpers the frame painter shares.
// Ported from the winning prototype; the glows are blurred once per layout and composited per frame.

import { at } from "../at";
import type { Dust, Geometry, Pt, Ray } from "./types";

/** Glow layers are rendered at half resolution and scaled up: they are soft by design. */
export const GLOW_SCALE = 0.5;

const hexCache: Record<string, [number, number, number]> = {};
export function hexA(h: string, a: number): string {
  let c = hexCache[h];
  if (!c) c = hexCache[h] = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

export function ease(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - c, 3);
}
/** Eased progress of `p` through the window [a, b]. */
export const seg = (p: number, a: number, b: number): number => ease((p - a) / (b - a));

/** Trace a fan: half-width hw0 at the origin widening to hw1 at fraction `f` of the way to the end. */
export function rayPoly(ctx: CanvasRenderingContext2D, r: { O: Pt; E: Pt }, hw0: number, hw1: number, f: number, sc = 1): void {
  const { O, E } = r;
  const ex = O[0] + (E[0] - O[0]) * f;
  const ey = O[1] + (E[1] - O[1]) * f;
  const dx = E[0] - O[0], dy = E[1] - O[1];
  const L = Math.hypot(dx, dy);
  const nx = -dy / L, ny = dx / L;
  const h1 = hw0 + (hw1 - hw0) * f;
  ctx.beginPath();
  ctx.moveTo((O[0] + nx * hw0) * sc, (O[1] + ny * hw0) * sc);
  ctx.lineTo((ex + nx * h1) * sc, (ey + ny * h1) * sc);
  ctx.lineTo((ex - nx * h1) * sc, (ey - ny * h1) * sc);
  ctx.lineTo((O[0] - nx * hw0) * sc, (O[1] - ny * hw0) * sc);
  ctx.closePath();
}

export function flare(c: CanvasRenderingContext2D, P: Pt, r: number, a: number): void {
  const fg = c.createRadialGradient(P[0], P[1], 0, P[0], P[1], r);
  fg.addColorStop(0, `rgba(255,255,255,${a})`);
  fg.addColorStop(0.25, `rgba(255,255,255,${a * 0.35})`);
  fg.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = fg;
  c.beginPath();
  c.arc(P[0], P[1], r, 0, 6.283);
  c.fill();
}

function layer(W: number, H: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.ceil(W * GLOW_SCALE);
  c.height = Math.ceil(H * GLOW_SCALE);
  return [c, c.getContext("2d") as CanvasRenderingContext2D];
}

export interface GlowSet {
  glow: HTMLCanvasElement[];
  glowIn: HTMLCanvasElement;
}

/** One blurred glow layer per line, plus one for the incoming beam and the two flares. */
export function buildGlow(W: number, H: number, g: Geometry, hues: readonly string[], halfW: (i: number) => number): GlowSet {
  const GS = GLOW_SCALE;
  const glow = g.rays.map((r: Ray, i) => {
    const [c, x] = layer(W, H);
    x.filter = `blur(${Math.round(16 * g.U * GS + 4)}px)`;
    x.globalAlpha = 0.55;
    x.fillStyle = at(hues, i);
    rayPoly(x, r, 3 * g.U, halfW(i) * 2.6, 1, GS);
    x.fill();
    x.filter = `blur(${Math.round(50 * g.U * GS + 6)}px)`;
    x.globalAlpha = 0.38;
    x.beginPath();
    x.ellipse(r.E[0] * GS, r.E[1] * GS, 70 * g.U * GS, 34 * g.U * GS, 0, 0, Math.PI * 2);
    x.fill();
    return c;
  });
  const [glowIn, x] = layer(W, H);
  x.filter = `blur(${Math.round(14 * g.U * GS + 4)}px)`;
  x.fillStyle = "#fff";
  x.globalAlpha = 0.5;
  rayPoly(x, { O: g.S, E: g.E }, 6 * g.U, 6 * g.U, 1, GS);
  x.fill();
  x.filter = `blur(${Math.round(40 * g.U * GS + 6)}px)`;
  x.globalAlpha = 0.55;
  x.beginPath();
  x.arc(g.X[0] * GS, g.X[1] * GS, 46 * g.U * GS, 0, Math.PI * 2);
  x.fill();
  x.beginPath();
  x.arc(g.E[0] * GS, g.E[1] * GS, 30 * g.U * GS, 0, Math.PI * 2);
  x.fill();
  return { glow, glowIn };
}

export function seedDust(W: number, H: number, mobile: boolean): Dust[] {
  const n = mobile ? 110 : Math.round(200 + (W * H) / 16000);
  const dust: Dust[] = [];
  for (let i = 0; i < n; i++) {
    dust.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 6,
      vy: -(4 + Math.random() * 10),
      r: 0.5 + Math.random() * 1.4,
      ph: Math.random() * 6.28,
    });
  }
  return dust;
}
