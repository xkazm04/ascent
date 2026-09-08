// The ONE coordinate authority for the canvas (viewport-transform). A camera is (pan x, pan y, zoom z)
// with `screen = world * z + pan`; every screen↔world conversion in the scene — pointer math, drag
// deltas, culling, fit, zoom-to-point — is a call into this file. Nothing else multiplies or divides
// by `z`. The two derived values the technique names as the authority's own — the visible world
// rectangle and the fit-to-content transform — live here too, so neither can be a stale copy
// (one-authority-per-vocabulary; derivation-names-recomputation). Pure: no React, no DOM.

export type Camera = { x: number; y: number; z: number };
export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

/** Clamped here, never at a call site: an unclamped path (an inertial wheel) reaches a blank screen. */
export const MIN_Z = 0.02;
export const MAX_Z = 4;
export const clampZ = (z: number): number => Math.min(MAX_Z, Math.max(MIN_Z, z));

export const toScreen = (cam: Camera, p: Pt): Pt => ({ x: p.x * cam.z + cam.x, y: p.y * cam.z + cam.y });
export const toWorld = (cam: Camera, p: Pt): Pt => ({ x: (p.x - cam.x) / cam.z, y: (p.y - cam.y) / cam.z });
/** A screen-space delta as a world-space delta — what a drag applies to a node at any zoom. */
export const worldDelta = (cam: Camera, dx: number, dy: number): Pt => ({ x: dx / cam.z, y: dy / cam.z });

/**
 * Zoom pinned to a screen point: the world position under `pivot` before the zoom is still under
 * it after. Written once; wheel, pinch, keys and buttons all route here and differ only in the pivot.
 */
export function zoomAt(cam: Camera, pivot: Pt, nextZ: number): Camera {
  const w = toWorld(cam, pivot);
  const z = clampZ(nextZ);
  return { z, x: pivot.x - w.x * z, y: pivot.y - w.y * z };
}

/** The world rectangle the viewport shows, grown by `margin` world units on every side (the overscan). */
export function visibleRect(cam: Camera, size: Size, margin = 0): Rect {
  const tl = toWorld(cam, { x: 0, y: 0 });
  const br = toWorld(cam, { x: size.w, y: size.h });
  return { x: tl.x - margin, y: tl.y - margin, w: br.x - tl.x + margin * 2, h: br.y - tl.y + margin * 2 };
}

/** The camera that frames `rect` inside `size` with `pad` screen pixels of breathing room. */
export function fitTo(rect: Rect, size: Size, pad = 32): Camera {
  const z = clampZ(Math.min((size.w - pad * 2) / Math.max(1, rect.w), (size.h - pad * 2) / Math.max(1, rect.h)));
  return { z, x: size.w / 2 - (rect.x + rect.w / 2) * z, y: size.h / 2 - (rect.y + rect.h / 2) * z };
}

/** A camera at the same zoom whose viewport centre is the world point `p`. */
export function centerOn(cam: Camera, p: Pt, size: Size): Camera {
  return { z: cam.z, x: size.w / 2 - p.x * cam.z, y: size.h / 2 - p.y * cam.z };
}

/** The transform the world <g> carries — the only serialisation of a camera into the DOM. */
export const camTransform = (cam: Camera): string => `translate(${cam.x} ${cam.y}) scale(${cam.z})`;

export const rectsIntersect = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const rectContains = (r: Rect, p: Pt): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** Interpolate between two cameras — the programmatic flight, sampled by the hook's tween. */
export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
