// Hit-testing against the nine fans: which line is under the pointer, and how brightly a mote of dust is lit.

import { at } from "../at";
import type { EngineState, Geometry } from "./types";

/** Index of the line whose fan is nearest (x, y) within a tolerance, or -1. */
export function nearestRay(g: Geometry, halfW: (i: number) => number, x: number, y: number): number {
  let best = -1;
  let bd = 1e9;
  g.rays.forEach((r, i) => {
    const dx = r.E[0] - r.O[0], dy = r.E[1] - r.O[1];
    const L2 = dx * dx + dy * dy;
    const u = ((x - r.O[0]) * dx + (y - r.O[1]) * dy) / L2;
    if (u < 0.08 || u > 1.02) return;
    const d = Math.hypot(x - (r.O[0] + dx * u), y - (r.O[1] + dy * u));
    const th = Math.max(12, halfW(i) * u + 8);
    if (d < th && d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Brightness (0..1+) and hue of the light at a point: the strongest fan there, or the white beam. */
export function lightAt(st: EngineState, x: number, y: number): [number, string | null] {
  const { g, intensity, hues, halfW } = st;
  let best = 0;
  let hue: string | null = null;
  for (let i = 0; i < g.rays.length; i++) {
    const r = at(g.rays, i);
    const dx = r.E[0] - r.O[0], dy = r.E[1] - r.O[1];
    const L2 = dx * dx + dy * dy;
    const u = ((x - r.O[0]) * dx + (y - r.O[1]) * dy) / L2;
    if (u < 0 || u > 1) continue;
    const d = Math.hypot(x - (r.O[0] + dx * u), y - (r.O[1] + dy * u));
    const hw = (2 * g.U + (halfW(i) - 2 * g.U) * u) * 1.9;
    if (d < hw) {
      const v = (1 - d / hw) * at(intensity, i);
      if (v > best) {
        best = v;
        hue = at(hues, i);
      }
    }
  }
  const dx0 = g.E[0] - g.S[0], dy0 = g.E[1] - g.S[1];
  const L0 = dx0 * dx0 + dy0 * dy0;
  const u0 = ((x - g.S[0]) * dx0 + (y - g.S[1]) * dy0) / L0;
  if (u0 >= 0 && u0 <= 1) {
    const d0 = Math.hypot(x - (g.S[0] + dx0 * u0), y - (g.S[1] + dy0 * u0));
    if (d0 < 12 * g.U) {
      const v0 = (1 - d0 / (12 * g.U)) * 0.9;
      if (v0 > best) {
        best = v0;
        hue = "#ffffff";
      }
    }
  }
  return [best, hue];
}
