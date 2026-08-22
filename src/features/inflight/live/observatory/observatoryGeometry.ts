// Observatory geometry — clustering, lasso hit-testing and the drift curve. Split out of
// observatoryModel.ts to stay under the 200-line features cap; re-exported from the barrel so the
// public surface reads as one module.

import { QUADRANT_LABEL, isPlotted, quadrantOf, type ObservatoryBody, type PlottedBody, type QuadrantId } from "./observatoryModel";

export interface ObservatoryCluster {
  kind: "cluster";
  /** Stable id: the grid cell it aggregates ("c:<col>:<row>"). */
  id: string;
  x: number;
  y: number;
  r: number;
  count: number;
  members: PlottedBody[];
  quadrant: QuadrantId;
  label: string;
}

export type ObservatoryItem = PlottedBody | ObservatoryCluster;

export const isCluster = (i: ObservatoryItem): i is ObservatoryCluster => i.kind === "cluster";

/**
 * Above `threshold` plotted bodies the field aggregates into a `cells × cells` grid: any cell holding
 * two or more bodies becomes one cluster carrying its count and members (the component owns the
 * click-to-expand state). At or below the threshold every body is returned as itself, so a small
 * fleet is never abstracted away. Deterministic: cells are walked in column-major id order.
 */
export function clusterBodies(bodies: readonly ObservatoryBody[], threshold = 40, cells = 6): ObservatoryItem[] {
  const plotted = bodies.filter(isPlotted);
  if (plotted.length <= threshold) return plotted;

  const buckets = new Map<string, PlottedBody[]>();
  const idx = (v: number) => Math.min(cells - 1, Math.max(0, Math.floor((v / 100) * cells)));
  for (const b of plotted) {
    const key = `c:${idx(b.x)}:${idx(b.y)}`;
    const list = buckets.get(key);
    if (list) list.push(b);
    else buckets.set(key, [b]);
  }

  const out: ObservatoryItem[] = [];
  for (const [id, members] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (members.length === 1) {
      out.push(members[0]!);
      continue;
    }
    const x = members.reduce((s, m) => s + m.x, 0) / members.length;
    const y = members.reduce((s, m) => s + m.y, 0) / members.length;
    const quadrant = quadrantOf({ x, y })!;
    out.push({
      kind: "cluster",
      id,
      x,
      y,
      // Grows with the member count but stays a ring, not a blob.
      r: Math.min(30, 12 + Math.sqrt(members.length) * 3),
      count: members.length,
      members,
      quadrant,
      label: `${members.length} repos · ${QUADRANT_LABEL[quadrant]}`,
    });
  }
  return out;
}

export interface Pt {
  x: number;
  y: number;
}

/** Even-odd ray casting. Points exactly on an edge are not guaranteed either way (documented). */
export function pointInPolygon(polygon: readonly Pt[], p: Pt): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const straddles = a.y > p.y !== b.y > p.y;
    if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Which repos a lasso caught. `polygon` is in the SAME 0–100 data space as the items. A cluster is
 * hit when its CENTRE is inside (its members are then all selected) — selection is always expressed
 * as repo full names, so the list and the field share one selection vocabulary.
 */
export function lassoHitTest(polygon: readonly Pt[], items: readonly ObservatoryItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (!pointInPolygon(polygon, { x: item.x, y: item.y })) continue;
    if (isCluster(item)) out.push(...item.members.map((m) => m.fullName));
    else out.push(item.fullName);
  }
  return out;
}

/** A rectangle (in data space) as the 4-point polygon lassoHitTest expects. */
export function rectPolygon(a: Pt, b: Pt): Pt[] {
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
}

/** Control point of the drift arc: the midpoint pushed perpendicular to the chord. */
function control(before: Pt, after: Pt, bow: number): Pt {
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const mx = (before.x + after.x) / 2;
  const my = (before.y + after.y) / 2;
  return { x: mx - dy * bow, y: my + dx * bow };
}

/**
 * A gentle quadratic arc from `before` to `after` — bodies glide, they don't snap along a chord.
 * Returned in data space; the caller projects. `bow` is the perpendicular offset as a fraction of the
 * chord (0 = straight).
 */
export function driftPath(before: Pt, after: Pt, bow = 0.18): string {
  const c = control(before, after, bow);
  return `M ${before.x} ${before.y} Q ${c.x} ${c.y} ${after.x} ${after.y}`;
}

/** The point at `t` (0→1) along the same arc `driftPath` draws — the tween's position source. */
export function driftPoint(before: Pt, after: Pt, t: number, bow = 0.18): Pt {
  const c = control(before, after, bow);
  const u = 1 - t;
  return {
    x: u * u * before.x + 2 * u * t * c.x + t * t * after.x,
    y: u * u * before.y + 2 * u * t * c.y + t * t * after.y,
  };
}
