"use client";

// The camera hook (viewport-transform): committed state is the truth; during a gesture the world <g>
// is driven imperatively from `live` and the state commits at most once per animation frame (wheel)
// or once on release (pan) — plus one interim commit every half cull-margin of travel so the culled
// world follows a long pan. A layout effect re-asserts the live transform after any render that lands
// mid-gesture (the reconciliation guard). The wheel listener is native and non-passive on the svg
// itself. Programmatic travel is a tween any wheel or press cancels; under `reduced` it is a cut.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent } from "react";
import { camTransform, centerOn, fitTo, lerpCamera, zoomAt, type Camera, type Pt, type Rect, type Size } from "./camera";
import { CULL_MARGIN } from "./geometry";

export const SLOP_PX = 3;
export const FLY_MS = 320;
const DEFAULT_SIZE: Size = { w: 800, h: 480 };

export type CameraStats = { commits: number; wheelEvents: number; gestureFrames: number; interimCommits: number };
export type PanPhase = "idle" | "press" | "pan";

export function useCamera(reduced: boolean, initial: Camera) {
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const [cam, setCam] = useState<Camera>(initial);
  const [size, setSize] = useState<Size>(DEFAULT_SIZE);
  const [phase, setPhase] = useState<PanPhase>("idle");
  const live = useRef<Camera>(initial);
  const stats = useRef<CameraStats>({ commits: 0, wheelEvents: 0, gestureFrames: 0, interimCommits: 0 });
  const gesture = useRef<{ ox: number; oy: number; start: Camera; panning: boolean; lastCommit: Pt } | null>(null);
  const suppressClick = useRef(false);
  const flight = useRef<number>(0);
  const wheelAccum = useRef<{ factor: number; pivot: Pt; raf: number } | null>(null);

  const applyLive = useCallback(() => {
    worldRef.current?.setAttribute("transform", camTransform(live.current));
  }, []);
  const commit = useCallback(() => {
    stats.current.commits += 1;
    setCam({ ...live.current });
  }, []);

  // Committed state and the live copy agree whenever no gesture holds the loan.
  useEffect(() => {
    if (!gesture.current?.panning && !flight.current) live.current = cam;
  }, [cam]);
  // The reconciliation guard: a render mid-gesture rewrites the <g> to the stale committed camera.
  useLayoutEffect(() => {
    if (gesture.current?.panning || flight.current) applyLive();
  });

  // The viewport is measured before anything is culled; where no observer exists (jsdom) the default
  // size stands in and counts as measured — the point is never to mount the whole world in pass one.
  const [measured, setMeasured] = useState(false);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      setMeasured(true);
      return;
    }
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
      setMeasured(true);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cancelFlight = useCallback(() => {
    if (!flight.current) return;
    cancelAnimationFrame(flight.current);
    flight.current = 0;
    commit(); // a cancelled tween still resolves: callers observe wherever the camera ended up
  }, [commit]);

  /** Programmatic travel: a cut under `reduced`, a cancellable tween otherwise. */
  const fly = useCallback(
    (target: Camera) => {
      cancelFlight();
      if (reduced) {
        live.current = target;
        applyLive();
        commit();
        return;
      }
      const from = { ...live.current };
      const t0 = performance.now();
      const step = (now: number) => {
        const q = Math.min(1, (now - t0) / FLY_MS);
        live.current = lerpCamera(from, target, 1 - Math.pow(1 - q, 3));
        applyLive();
        if (q < 1) flight.current = requestAnimationFrame(step);
        else {
          flight.current = 0;
          commit();
        }
      };
      flight.current = requestAnimationFrame(step);
    },
    [applyLive, cancelFlight, commit, reduced],
  );

  // Wheel: native + non-passive (React's synthetic wheel cannot preventDefault), attached to the svg —
  // the element that genuinely owns canvas pixels — never to the container the panels also live in.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelFlight();
      stats.current.wheelEvents += 1;
      const box = el.getBoundingClientRect();
      const pivot = { x: e.clientX - box.left, y: e.clientY - box.top };
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)); // pinch arrives ctrl-flagged
      const acc = wheelAccum.current;
      if (acc) {
        acc.factor *= factor;
        acc.pivot = pivot;
        return;
      }
      wheelAccum.current = {
        factor,
        pivot,
        raf: requestAnimationFrame(() => {
          const a = wheelAccum.current;
          wheelAccum.current = null;
          if (!a) return;
          live.current = zoomAt(live.current, a.pivot, live.current.z * a.factor);
          applyLive();
          stats.current.gestureFrames += 1;
          commit(); // at most one commit per frame, however many notches arrived
        }),
      };
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyLive, cancelFlight, commit]);

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    cancelFlight();
    gesture.current = { ox: e.clientX, oy: e.clientY, start: { ...live.current }, panning: false, lastCommit: { x: e.clientX, y: e.clientY } };
    setPhase("press");
  };
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.ox;
    const dy = e.clientY - g.oy;
    if (!g.panning) {
      if (Math.hypot(dx, dy) < SLOP_PX) return;
      g.panning = true; // capture at the threshold, not at press: child clicks must keep firing
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setPhase("pan");
    }
    live.current = { ...g.start, x: g.start.x + dx, y: g.start.y + dy }; // origin + delta, never accumulated
    applyLive();
    stats.current.gestureFrames += 1;
    if (Math.hypot(e.clientX - g.lastCommit.x, e.clientY - g.lastCommit.y) > (CULL_MARGIN / 2) * live.current.z) {
      g.lastCommit = { x: e.clientX, y: e.clientY };
      stats.current.interimCommits += 1;
      commit();
    }
  };
  const endGesture = (e: RPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (g.panning) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      suppressClick.current = true; // the platform will still synthesize a click from this press
      commit();
    }
    setPhase("idle");
  };
  const onClickCapture = (e: RMouseEvent<SVGSVGElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  const zoomBy = useCallback((factor: number) => fly(zoomAt(live.current, { x: size.w / 2, y: size.h / 2 }, live.current.z * factor)), [fly, size]);
  const fit = useCallback((rect: Rect) => fly(fitTo(rect, size)), [fly, size]);
  const panTo = useCallback((p: Pt) => fly(centerOn(live.current, p, size)), [fly, size]);

  return { cam, size, measured, phase, live, stats, svgRef, worldRef, zoomBy, fit, panTo, handlers: { onPointerDown, onPointerMove, onPointerUp: endGesture, onPointerCancel: endGesture, onClickCapture } };
}

export type CameraApi = ReturnType<typeof useCamera>;
