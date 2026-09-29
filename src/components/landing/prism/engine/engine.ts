// The Prism hero engine: owns the canvas, the intro clock, hover intensity and the rAF loop, and reports
// layout / phase / pointer events to React through callbacks. It never touches React-owned markup: the
// labels, annotations and stage copy are rendered by PrismHero from the Layout it hands back.
// Ported from the winning prototype; behaviour is unchanged.

import { at } from "../at";
import { drawFrame } from "./draw";
import { computeLayout } from "./geometry";
import { buildGlow, seedDust } from "./glow";
import { nearestRay } from "./light";
import type { EngineState, Layout } from "./types";
import { ARCHETYPES, DEFAULT_ARCHETYPE, PRISM_DIMS, weightOf, type Archetype } from "../prismModel";

/** Length of the arrival beat. Skippable at any moment; the page hands over control when it ends. */
export const INTRO_MS = 2700;

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  hero: HTMLElement;
  reduced: boolean;
  onLayout(layout: Layout): void;
  onPhase(phase: { ready: boolean; labels: boolean }): void;
  /** Raw pointer hover over the canvas: a line index, or -1 for "no line under the pointer". */
  onPointerHover(i: number): void;
  onPointerOpen(i: number): void;
}

export interface PrismEngine {
  setHover(i: number): void;
  setArch(a: Archetype): void;
  /** Pause while a scene covers the hero. */
  setPaused(paused: boolean): void;
  skipIntro(): void;
  /** Geometry for the "line floods the screen" beat, or null when it should be skipped. */
  flashSpec(i: number): { cx: number; cy: number; length: number; angle: number; half: number; hue: string } | null;
  destroy(): void;
}

export function createPrismEngine(o: EngineOptions): PrismEngine {
  const { canvas, hero, reduced } = o;
  const RM = reduced;
  const hues = PRISM_DIMS.map((d) => d.hue);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

  let arch: Archetype = DEFAULT_ARCHETYPE;
  let layout: Layout | null = null;
  let hover = -1;
  let introDone = RM;
  let labelsOn = RM;
  let readyOn = RM;
  const t0 = performance.now();
  let last = t0;
  let raf = 0;
  let inView = true;
  let visible = !document.hidden;
  let paused = false;
  let destroyed = false;
  let resizeTimer = 0;

  const st: EngineState = {
    ctx, W: 0, H: 0, dpr: 1, mobile: false, reduced: RM, introDone,
    g: computeLayout(1600, 1000, PRISM_DIMS.length).geometry,
    hues,
    intensity: hues.map(() => 0),
    glow: [], glowIn: null, dust: [],
    halfW: (i) => (st.mobile ? 0.8 : 1) * (weightOf(i, arch) * 78) * st.g.U,
  };

  const running = () => inView && visible && !paused && !destroyed;
  const kick = () => {
    if (!raf && running()) raf = requestAnimationFrame(frame);
  };

  function rebuildGlow(): void {
    const set = buildGlow(st.W, st.H, st.g, hues, st.halfW);
    st.glow = set.glow;
    st.glowIn = set.glowIn;
  }

  function geom(): void {
    const r = hero.getBoundingClientRect();
    st.W = Math.round(r.width);
    st.H = Math.round(r.height);
    st.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(st.W * st.dpr);
    canvas.height = Math.round(st.H * st.dpr);
    layout = computeLayout(st.W, st.H, PRISM_DIMS.length);
    st.mobile = layout.mobile;
    st.g = layout.geometry;
    rebuildGlow();
    st.dust = seedDust(st.W, st.H, st.mobile);
    o.onLayout(layout);
  }

  function setPhase(ready: boolean, labels: boolean): void {
    if (ready === readyOn && labels === labelsOn) return;
    readyOn = ready;
    labelsOn = labels;
    o.onPhase({ ready, labels });
  }

  function finishIntro(): void {
    introDone = true;
    st.introDone = true;
    setPhase(true, true);
  }

  function frame(now: number): void {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const p = introDone ? 1 : Math.min(1, (now - t0) / INTRO_MS);
    if (!introDone && p >= 1) finishIntro();
    setPhase(readyOn || p > 0.5, labelsOn || p > 0.72);
    const T = now / 1000;
    for (let i = 0; i < st.intensity.length; i++) {
      const tg = hover < 0 ? (RM ? 1 : 0.9 + 0.1 * Math.sin(T * 0.9 + i * 0.8)) : i === hover ? 1.5 : 0.16;
      const cur = at(st.intensity, i);
      st.intensity[i] = cur + (tg - cur) * Math.min(1, dt * (RM ? 60 : 7));
    }
    drawFrame(st, p, T, dt);
    if (running() && (!RM || !introDone)) raf = requestAnimationFrame(frame);
  }

  function skipIntro(): void {
    if (introDone) return;
    finishIntro();
    kick();
  }

  // --- pointer: the item under attention takes the stage
  const pointerXY = (e: PointerEvent | MouseEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const pick = (e: PointerEvent | MouseEvent): number =>
    !introDone ? -1 : nearestRay(st.g, st.halfW, ...pointerXY(e));
  const onMove = (e: PointerEvent) => {
    const i = pick(e);
    canvas.style.cursor = i >= 0 ? "pointer" : "default";
    o.onPointerHover(i);
  };
  const onLeave = () => o.onPointerHover(-1);
  const onClick = (e: MouseEvent) => {
    const i = pick(e);
    if (i >= 0) o.onPointerOpen(i);
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("click", onClick);

  const skipEvents = ["keydown", "wheel", "touchstart", "pointerdown"] as const;
  const onSkip = () => skipIntro();
  skipEvents.forEach((ev) => window.addEventListener(ev, onSkip, { passive: true }));

  const io = new IntersectionObserver((en) => {
    inView = en[0]?.isIntersecting ?? true;
    if (running()) kick();
  }, { threshold: 0 });
  io.observe(hero);
  const onVisibility = () => {
    visible = !document.hidden;
    if (running()) kick();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      geom();
      kick();
    }, 120);
  };
  window.addEventListener("resize", onResize);

  // --- boot
  if (RM) o.onPhase({ ready: true, labels: true });
  geom();
  kick();

  return {
    setHover(i) {
      if (i === hover) return;
      hover = i;
      if (RM) kick();
    },
    setArch(a) {
      if (!ARCHETYPES.includes(a)) return;
      arch = a;
      rebuildGlow();
      kick();
    },
    setPaused(p) {
      paused = p;
      if (running()) kick();
    },
    skipIntro,
    flashSpec(i) {
      if (RM || !layout || layout.mobile || !labelsOn) return null;
      const r = at(st.g.rays, i);
      const hr = hero.getBoundingClientRect();
      return {
        cx: (r.O[0] + r.E[0]) / 2 + hr.left,
        cy: (r.O[1] + r.E[1]) / 2 + hr.top,
        length: Math.hypot(r.E[0] - r.O[0], r.E[1] - r.O[1]),
        angle: Math.atan2(r.E[1] - r.O[1], r.E[0] - r.O[0]),
        half: st.halfW(i),
        hue: at(hues, i),
      };
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
      skipEvents.forEach((ev) => window.removeEventListener(ev, onSkip));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      io.disconnect();
    },
  };
}

