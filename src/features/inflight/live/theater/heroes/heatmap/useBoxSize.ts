"use client";

// The map area's pixel size — measured, because the treemap's labels choose their type by tile size
// (heatLayout.ts). Null until the first measurement: the map renders nothing rather than guessing a
// size and then visibly sliding every tile to the real one.

import { useEffect, useState, type RefObject } from "react";

export interface BoxSize {
  w: number;
  h: number;
}

export function useBoxSize(ref: RefObject<HTMLElement | null>): BoxSize | null {
  const [size, setSize] = useState<BoxSize | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      const next = { w: Math.round(r.width), h: Math.round(r.height) };
      setSize((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
