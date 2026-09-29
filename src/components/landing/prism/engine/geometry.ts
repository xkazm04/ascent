// Pure layout math for the hero: where the prism, the incoming beam, the nine lines and their labels sit
// for a given hero box. Ported from the winning prototype's geom(); nothing here touches the DOM, so it
// is unit-testable and the React layer gets plain numbers.

import type { Geometry, Layout, Pt, Ray } from "./types";

export const MOBILE_MAX = 760;

export function computeLayout(W: number, H: number, lineCount: number): Layout {
  const mobile = W <= MOBILE_MAX;
  let U: number, ox: number, oy: number, pc: Pt, s: number, xEnd: number, yT: number, yB: number, src: Pt;
  let cssU: string | null = null;
  let cssFL: string | null = null;
  if (!mobile) {
    U = Math.min(W / 1600, H / 1000);
    ox = (W - 1600 * U) / 2;
    oy = (H - 1000 * U) / 2;
    pc = [880, 560]; s = 3.55; xEnd = 1206; yT = 150; yB = 880; src = [590, 1000];
    cssU = `${U * 16}px`;
    cssFL = `${ox}px`;
  } else {
    U = Math.min(W / 390, H / 844);
    ox = (W - 390 * U) / 2;
    oy = H - 844 * U;
    pc = [118, 664]; s = 1.7; xEnd = 392; yT = 520; yB = 842; src = [10, 880];
  }
  const P = (x: number, y: number): Pt => [ox + x * U, oy + y * U];
  // The mark's own coordinates (0..100 box) mapped onto the prism.
  const g = (gx: number, gy: number): Pt => P(pc[0] + (gx - 50) * s, pc[1] + (gy - 62) * s);

  const A = g(50, 10), BL = g(14, 88), BR = g(86, 88), E = g(27.7, 58.4), X = g(68.7, 50.6);
  let S = P(src[0], src[1]);
  // extend the incoming beam to the bottom edge of the viewport
  const dx = E[0] - S[0], dy = E[1] - S[1];
  S = [E[0] + dx * ((H + 40 - E[1]) / dy), H + 40];

  const rays: Ray[] = Array.from({ length: lineCount }, (_v, i) => {
    const t = 0.47 + i * (0.1 / (lineCount - 1));
    return { O: g(50 + 36 * t, 10 + 78 * t), E: P(xEnd, yT + (i * (yB - yT)) / (lineCount - 1)), i };
  });
  const geometry: Geometry = { U, A, BL, BR, E, X, S, rays };

  let labels: Layout["labels"] = [];
  let annIn: Layout["annIn"] = null;
  let annOut: Layout["annOut"] = null;
  let archSwitch: Layout["archSwitch"] = null;
  if (!mobile) {
    labels = rays.map((r) => ({ left: r.E[0] + 14 * U, top: r.E[1] }));
    const mid: Pt = [E[0] + (S[0] - E[0]) * 0.3, E[1] + (S[1] - E[1]) * 0.3];
    annIn = { left: mid[0] + 26 * U, top: mid[1] };
    annOut = { right: W - A[0] + 30 * U, top: A[1] - 10 * U };
    archSwitch = { right: W - P(1560, 0)[0], top: P(0, 936)[1] };
  }
  return { W, H, mobile, geometry, cssU, cssFL, labels, annIn, annOut, archSwitch };
}
