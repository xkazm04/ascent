"use client";

// Wires the canvas engine to React: builds it after mount, hands back the layout (label positions) and
// the intro phase as state, and owns the hover-intent rule (a 140 ms grace before the stage lets go of a
// line, so moving between a beam and its label does not flicker the headline).

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPrismEngine, type PrismEngine } from "./engine/engine";
import type { Layout } from "./engine/types";
import type { Archetype } from "./prismModel";

export interface Phase {
  ready: boolean;
  labels: boolean;
}

interface Args {
  rootRef: RefObject<HTMLElement | null>;
  heroRef: RefObject<HTMLElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  reduced: boolean;
  arch: Archetype;
  paused: boolean;
  onOpen(i: number, from: HTMLElement | null): void;
}

export function usePrismHero({ rootRef, heroRef, canvasRef, reduced, arch, paused, onOpen }: Args) {
  const engineRef = useRef<PrismEngine | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [phase, setPhase] = useState<Phase>({ ready: false, labels: false });
  const [hover, setHoverState] = useState(-1);
  const [shown, setShown] = useState(0);
  const hoverRef = useRef(-1);
  const timer = useRef(0);
  const openRef = useRef(onOpen);
  useEffect(() => {
    openRef.current = onOpen;
  });

  const setHover = useCallback((i: number, delayed = false) => {
    window.clearTimeout(timer.current);
    if (i < 0 && delayed) {
      timer.current = window.setTimeout(() => {
        hoverRef.current = -1;
        setHoverState(-1);
      }, 140);
      return;
    }
    hoverRef.current = i;
    setHoverState(i);
    if (i >= 0) setShown(i);
  }, []);

  useEffect(() => engineRef.current?.setHover(hover), [hover]);
  useEffect(() => engineRef.current?.setArch(arch), [arch]);
  useEffect(() => engineRef.current?.setPaused(paused), [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hero = heroRef.current;
    if (!canvas || !hero) return;
    const labelEl = (i: number) => rootRef.current?.querySelectorAll<HTMLElement>(".ray-label")[i] ?? null;
    const engine = createPrismEngine({
      canvas,
      hero,
      reduced,
      onLayout(l) {
        const root = rootRef.current;
        if (root) {
          if (l.cssU) root.style.setProperty("--U", l.cssU);
          else root.style.removeProperty("--U");
          if (l.cssFL) root.style.setProperty("--FL", l.cssFL);
          else root.style.removeProperty("--FL");
        }
        setLayout(l);
      },
      onPhase: setPhase,
      onPointerHover(i) {
        if (i >= 0) setHover(i);
        else if (hoverRef.current >= 0 && !rootRef.current?.querySelector(".ray-label:hover")) setHover(-1, true);
      },
      onPointerOpen: (i) => openRef.current(i, labelEl(i)),
    });
    engineRef.current = engine;
    engine.setArch(arch);
    engine.setPaused(paused);
    return () => {
      engine.destroy();
      engineRef.current = null;
      window.clearTimeout(timer.current);
    };
    // The engine is rebuilt only when the motion preference flips; arch and pause are pushed by the
    // effects above and again here so a rebuilt engine starts in the current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return { engineRef, layout, phase, hover, shown, setHover };
}
