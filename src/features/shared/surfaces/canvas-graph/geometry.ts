// Shared geometry (edge-management + graph-layout): ONE node size, ONE bounds function, ONE anchor
// function — consumed by node rendering, edge rendering, hit-testing, culling and layout alike, so an
// edge and its node cannot disagree about where the node's border is. Also the deterministic layered
// layout, the placement policy for new nodes, and the zoom-detail ramps (render-budget rung 4). Pure.

import { rectsIntersect, type Pt, type Rect } from "./camera";
import type { Graph, GraphNode } from "./fixtures";

export const NODE_W = 150;
export const NODE_H = 44;
export const LAYER_GAP = 260;
export const ROW_GAP = 72;
/** Overscan: an element is culled only once its whole body is clear of the viewport (no popping). */
export const CULL_MARGIN = 200;

export const nodeBounds = (p: Pt): Rect => ({ x: p.x, y: p.y, w: NODE_W, h: NODE_H });
export const nodeCenter = (p: Pt): Pt => ({ x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 });

/** The boundary point of the node at `p` that faces `toward` — where an edge attaches, recomputed as nodes move so an edge never enters a node's back. */
export function anchorToward(p: Pt, toward: Pt): Pt {
  const c = nodeCenter(p);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx === 0 ? Infinity : NODE_W / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : NODE_H / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/** A soft horizontal-out / horizontal-in sweep between two anchors (the pipeline convention). */
export function edgePath(a: Pt, b: Pt): string {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${(a.x + dx).toFixed(1)} ${a.y.toFixed(1)}, ${(b.x - dx).toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

/** The edge's own geometry for culling: its curve's bounding box (control points included), so a long link whose endpoints are both offscreen still draws where it crosses the viewport. */
export function edgeBounds(a: Pt, b: Pt): Rect {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  const x0 = Math.min(a.x, b.x, a.x + dx, b.x - dx);
  const x1 = Math.max(a.x, b.x, a.x + dx, b.x - dx);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export const edgeVisible = (a: Pt, b: Pt, view: Rect): boolean => rectsIntersect(edgeBounds(a, b), view);

/** The generated position of a base node: layered (tidy), deterministic; `run` toggles a staggered variant so "re-layout" is visible. */
export function generatedPosition(n: GraphNode, run: number): Pt {
  const stagger = run % 2 === 1 && n.layer % 2 === 1 ? ROW_GAP / 2 : 0;
  return { x: n.layer * LAYER_GAP, y: n.row * ROW_GAP + stagger };
}

/** The world rectangle of the whole generated layout. */
export function worldBounds(graph: Graph): Rect {
  const rows = Math.ceil(graph.nodes.length / graph.layers);
  return { x: 0, y: 0, w: (graph.layers - 1) * LAYER_GAP + NODE_W, h: rows * ROW_GAP + NODE_H };
}

/**
 * Placement policy: a node with no position lands beside its neighbour (or at `fallback`, the
 * viewport centre), probing outward ring by ring until the slot is clear of every occupied rect.
 */
export function placeNear(from: Pt, occupied: readonly Rect[], fallbackRings = 12): Pt {
  const clear = (p: Pt) => !occupied.some((r) => rectsIntersect(nodeBounds(p), r));
  const first = { x: from.x + LAYER_GAP, y: from.y };
  if (clear(first)) return first;
  for (let ring = 1; ring <= fallbackRings; ring++) {
    for (let k = -ring; k <= ring; k++) {
      const cands = [
        { x: first.x + k * (NODE_W + 20), y: first.y - ring * ROW_GAP },
        { x: first.x + k * (NODE_W + 20), y: first.y + ring * ROW_GAP },
        { x: first.x - ring * (NODE_W + 20), y: first.y + k * ROW_GAP },
        { x: first.x + ring * (NODE_W + 20), y: first.y + k * ROW_GAP },
      ];
      for (const c of cands) if (clear(c)) return c;
    }
  }
  return { x: first.x, y: first.y + (fallbackRings + 1) * ROW_GAP };
}

/* ── Detail as a function of zoom (rung 4) ─────────────────────────────────────────────────────── */

/** Below this zoom the world is drawn as one column per layer and one bundle per adjacent pair. */
export const BUNDLE_Z = 0.18;
/** Below this zoom nodes are bare rects: no label, no ports, no badge. */
export const DETAIL_Z = 0.45;

/** An opacity ramp, not a step: detail fades in across [from, to] so a zoom crossing never pops. */
export const lod = (z: number, from: number, to: number): number => Math.max(0, Math.min(1, (z - from) / (to - from)));

/** Counter-scaled labels: text shrinks sub-linearly with zoom, readable far out without becoming a billboard up close. */
export const labelScale = (z: number): number => Math.pow(z, -0.62);

/** The visible detail tier the render list is derived for. */
export type Tier = "bundle" | "rect" | "full";
export const tierFor = (z: number): Tier => (z < BUNDLE_Z ? "bundle" : z < DETAIL_Z ? "rect" : "full");
