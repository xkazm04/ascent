// The hero's per-frame painter: goniometer scale, additive glows, incoming beam, the nine fans with
// their photons, the prism body, and the dust. Ported line for line from the winning prototype's frame();
// `p` is intro progress 0..1, `T` seconds on the clock, `dt` seconds since the last frame.

import { at } from "../at";
import { flare, hexA, rayPoly, seg } from "./glow";
import { lightAt } from "./light";
import type { EngineState } from "./types";

function drawGoniometer(st: EngineState, fP: number): void {
  const { ctx: c, g, mobile } = st;
  const R = (at(g.rays, 0).E[0] - g.X[0]) * 0.8;
  c.save();
  c.globalAlpha = 0.16 * fP;
  c.strokeStyle = "#f2eee6";
  c.lineWidth = 1;
  c.beginPath();
  c.arc(g.X[0], g.X[1], R, -1.05, 1.05);
  c.stroke();
  for (let a = -60; a <= 60; a += 2) {
    const ra = (a * Math.PI) / 180;
    const l = a % 10 === 0 ? 12 : 5;
    c.beginPath();
    c.moveTo(g.X[0] + Math.cos(ra) * R, g.X[1] + Math.sin(ra) * R);
    c.lineTo(g.X[0] + Math.cos(ra) * (R + l * g.U * 1.4), g.X[1] + Math.sin(ra) * (R + l * g.U * 1.4));
    c.stroke();
  }
  c.globalAlpha = 0.3 * fP;
  c.fillStyle = "#f2eee6";
  c.font = `${Math.round(11 * Math.max(1, g.U))}px Cascadia Mono,Consolas,monospace`;
  c.textAlign = "center";
  if (!mobile) {
    for (let a2 = -50; a2 <= 50; a2 += 10) {
      const rb = (a2 * Math.PI) / 180;
      c.fillText(`${Math.abs(a2)}°`, g.X[0] + Math.cos(rb) * (R + 30 * g.U), g.X[1] + Math.sin(rb) * (R + 30 * g.U) + 4);
    }
  }
  c.restore();
}

function drawRays(st: EngineState, p: number, T: number): void {
  const { ctx: c, g, hues, intensity, halfW, reduced } = st;
  for (let i = 0; i < g.rays.length; i++) {
    const fF = seg(p, 0.4 + i * 0.025, 0.72 + i * 0.025);
    if (fF <= 0) continue;
    const r = at(g.rays, i);
    const I = at(intensity, i);
    const h = at(hues, i);
    const g2 = c.createLinearGradient(r.O[0], r.O[1], r.E[0], r.E[1]);
    g2.addColorStop(0, `rgba(255,255,255,${0.9 * Math.min(1, I)})`);
    g2.addColorStop(0.1, hexA(h, 0.95 * Math.min(1, I)));
    g2.addColorStop(0.75, hexA(h, 0.55 * Math.min(1.2, I)));
    g2.addColorStop(1, hexA(h, 0.3 * Math.min(1.2, I)));
    c.fillStyle = g2;
    rayPoly(c, r, 1.1 * g.U, halfW(i), fF);
    c.fill();
    // core line
    c.strokeStyle = hexA("#ffffff", 0.35 * Math.min(1, I));
    c.lineWidth = Math.max(0.6, g.U * 0.9);
    c.beginPath();
    c.moveTo(r.O[0], r.O[1]);
    c.lineTo(r.O[0] + (r.E[0] - r.O[0]) * fF, r.O[1] + (r.E[1] - r.O[1]) * fF);
    c.stroke();
    // photons
    if (!reduced && st.introDone) {
      for (let q = 0; q < 3; q++) {
        const u = (T * (0.16 + i * 0.006) + q / 3 + i * 0.11) % 1;
        const u2 = Math.max(0, u - 0.07);
        const px = r.O[0] + (r.E[0] - r.O[0]) * u, py = r.O[1] + (r.E[1] - r.O[1]) * u;
        const qx = r.O[0] + (r.E[0] - r.O[0]) * u2, qy = r.O[1] + (r.E[1] - r.O[1]) * u2;
        const pg = c.createLinearGradient(qx, qy, px, py);
        pg.addColorStop(0, hexA(h, 0));
        pg.addColorStop(1, hexA("#ffffff", 0.55 * Math.min(1, I)));
        c.strokeStyle = pg;
        c.lineWidth = (1.1 * g.U + (halfW(i) - 1.1 * g.U) * u) * 0.9;
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(qx, qy);
        c.lineTo(px, py);
        c.stroke();
      }
    }
  }
  c.lineCap = "butt";
}

function drawPrism(st: EngineState, p: number, fP: number): void {
  const { ctx: c, g } = st;
  c.save();
  c.globalAlpha = fP;
  c.beginPath();
  c.moveTo(g.A[0], g.A[1]);
  c.lineTo(g.BR[0], g.BR[1]);
  c.lineTo(g.BL[0], g.BL[1]);
  c.closePath();
  const bg = c.createLinearGradient(g.BL[0], g.A[1], g.BR[0], g.BR[1]);
  bg.addColorStop(0, "rgba(200,210,255,.10)");
  bg.addColorStop(0.55, "rgba(120,130,200,.05)");
  bg.addColorStop(1, "rgba(255,255,255,.09)");
  c.fillStyle = bg;
  c.fill();
  c.strokeStyle = "rgba(242,238,230,.16)";
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(g.BL[0], g.BL[1]);
  c.lineTo(g.BR[0], g.BR[1]);
  c.stroke();
  c.shadowColor = "rgba(255,255,255,.7)";
  c.shadowBlur = 14 * g.U;
  const lg = c.createLinearGradient(g.A[0], g.A[1], g.BL[0], g.BL[1]);
  lg.addColorStop(0, "rgba(255,255,255,.95)");
  lg.addColorStop(1, "rgba(255,255,255,.55)");
  c.strokeStyle = lg;
  c.lineWidth = Math.max(1.2, 2.4 * g.U);
  c.lineJoin = "miter";
  c.beginPath();
  c.moveTo(g.BL[0], g.BL[1]);
  c.lineTo(g.A[0], g.A[1]);
  c.lineTo(g.BR[0], g.BR[1]);
  c.stroke();
  c.shadowBlur = 0;
  // refracted beam inside the glass
  c.globalCompositeOperation = "lighter";
  const ig = c.createLinearGradient(g.E[0], g.E[1], g.X[0], g.X[1]);
  ig.addColorStop(0, "rgba(255,255,255,.95)");
  ig.addColorStop(1, "rgba(225,228,255,.85)");
  c.strokeStyle = ig;
  c.lineWidth = 3 * g.U + 0.6;
  c.beginPath();
  c.moveTo(g.E[0], g.E[1]);
  const k = seg(p, 0.26, 0.44);
  c.lineTo(g.E[0] + (g.X[0] - g.E[0]) * k, g.E[1] + (g.X[1] - g.E[1]) * k);
  c.stroke();
  flare(c, g.E, 26 * g.U, 0.55 * fP);
  flare(c, g.X, 44 * g.U, 0.7 * fP);
  flare(c, g.A, 16 * g.U, 0.35 * fP);
  // inner reflection
  c.strokeStyle = "rgba(255,255,255,.08)";
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(g.E[0], g.E[1]);
  c.lineTo((g.BL[0] + g.BR[0]) / 2 + 20 * g.U, g.BL[1]);
  c.stroke();
  c.restore();
}

function drawDust(st: EngineState, fP: number, T: number, dt: number): void {
  const { ctx: c, dust, W, H, reduced } = st;
  c.globalCompositeOperation = "lighter";
  for (const d of dust) {
    if (!reduced) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y < -5) {
        d.y = H + 5;
        d.x = Math.random() * W;
      }
      if (d.x < -5) d.x = W + 5;
      if (d.x > W + 5) d.x = -5;
    }
    const L = lightAt(st, d.x, d.y);
    const tw = reduced ? 1 : 0.6 + 0.4 * Math.sin(T * 1.3 + d.ph);
    const al = (0.05 + L[0] * 0.95) * tw * fP;
    if (al < 0.02) continue;
    c.fillStyle = L[1] ? hexA(L[1], Math.min(1, al)) : `rgba(242,238,230,${al.toFixed(3)})`;
    c.beginPath();
    c.arc(d.x, d.y, d.r * (1 + L[0] * 0.9), 0, 6.283);
    c.fill();
  }
}

export function drawFrame(st: EngineState, p: number, T: number, dt: number): void {
  const { ctx: c, W, H, dpr, g, glow, glowIn, intensity } = st;
  const fB = seg(p, 0.02, 0.3);
  const fP = seg(p, 0.2, 0.48);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  c.globalCompositeOperation = "source-over";
  drawGoniometer(st, fP);
  // glows (additive)
  c.globalCompositeOperation = "lighter";
  if (glowIn) {
    c.globalAlpha = fB;
    c.drawImage(glowIn, 0, 0, W, H);
  }
  for (let i = 0; i < glow.length; i++) {
    const fF = seg(p, 0.4 + i * 0.025, 0.72 + i * 0.025);
    if (fF <= 0) continue;
    c.globalAlpha = Math.min(1, at(intensity, i) * fF * fF);
    c.drawImage(at(glow, i), 0, 0, W, H);
  }
  c.globalAlpha = 1;
  // incoming beam
  if (fB > 0) {
    const S = g.S, E = g.E;
    const ex = S[0] + (E[0] - S[0]) * fB, ey = S[1] + (E[1] - S[1]) * fB;
    const gr = c.createLinearGradient(S[0], S[1], E[0], E[1]);
    gr.addColorStop(0, "rgba(255,255,255,.15)");
    gr.addColorStop(0.5, "rgba(255,255,255,.75)");
    gr.addColorStop(1, "rgba(255,255,255,1)");
    c.strokeStyle = gr;
    c.lineWidth = 3.2 * g.U + 0.8;
    c.beginPath();
    c.moveTo(S[0], S[1]);
    c.lineTo(ex, ey);
    c.stroke();
  }
  drawRays(st, p, T);
  c.globalCompositeOperation = "source-over";
  if (fP > 0) drawPrism(st, p, fP);
  drawDust(st, fP, T, dt);
  c.globalCompositeOperation = "source-over";
  c.globalAlpha = 1;
}
