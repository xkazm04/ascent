"use client";

// The lasso. DECISION: a RECTANGLE, not a freehand loop. A rubber-band rectangle is the selection
// gesture every chart/desktop surface already teaches, it needs two points instead of a sampled
// path, and — the deciding reason — the field's meaningful regions ARE rectangles (the posture
// quadrants cut at 50/50), so "drag the top-right block" is the query users actually have.
// `lassoHitTest` still takes an arbitrary polygon, so a freehand mode can be added later without
// touching the model.

import { useRef, useState } from "react";
import { FIELD, projectX, projectY } from "./observatoryModel";
import { rectPolygon, type Pt } from "./observatoryGeometry";

export interface LassoState {
  from: Pt;
  to: Pt;
  additive: boolean;
}

/** Map a pointer event to 0–100 data space using the SVG's own viewBox scale. */
export function toData(svg: SVGSVGElement, clientX: number, clientY: number): Pt {
  const box = svg.getBoundingClientRect();
  const vx = ((clientX - box.left) / box.width) * FIELD.w;
  const vy = ((clientY - box.top) / box.height) * FIELD.h;
  const x = ((vx - FIELD.left) / (FIELD.w - FIELD.left - FIELD.right)) * 100;
  const y = (1 - (vy - FIELD.top) / (FIELD.h - FIELD.top - FIELD.bottom)) * 100;
  return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
}

/** Drag state + handlers for the rubber band; the field renders <LassoRect> from `lasso`. */
export function useLasso(onPick: (polygon: Pt[], additive: boolean) => void) {
  const [lasso, setLasso] = useState<LassoState | null>(null);
  const live = useRef<LassoState | null>(null);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const next = { from: toData(e.currentTarget, e.clientX, e.clientY), to: toData(e.currentTarget, e.clientX, e.clientY), additive: e.shiftKey };
    live.current = next;
    setLasso(next);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!live.current) return;
    const next = { ...live.current, to: toData(e.currentTarget, e.clientX, e.clientY) };
    live.current = next;
    setLasso(next);
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const l = live.current;
    live.current = null;
    setLasso(null);
    if (!l) return;
    // A click (no meaningful drag) clears rather than selecting an empty box.
    const dragged = Math.abs(l.to.x - l.from.x) > 1.5 || Math.abs(l.to.y - l.from.y) > 1.5;
    onPick(dragged ? rectPolygon(l.from, l.to) : [], l.additive);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return { lasso, handlers: { onPointerDown, onPointerMove, onPointerUp } };
}

export function LassoRect({ lasso }: { lasso: LassoState | null }) {
  if (!lasso) return null;
  const x1 = projectX(Math.min(lasso.from.x, lasso.to.x));
  const x2 = projectX(Math.max(lasso.from.x, lasso.to.x));
  const y1 = projectY(Math.max(lasso.from.y, lasso.to.y));
  const y2 = projectY(Math.min(lasso.from.y, lasso.to.y));
  return (
    <rect
      x={x1}
      y={y1}
      width={Math.max(0, x2 - x1)}
      height={Math.max(0, y2 - y1)}
      className="fill-accent stroke-accent"
      fillOpacity={0.06}
      strokeWidth={1}
      strokeDasharray="4 3"
      pointerEvents="none"
    />
  );
}
