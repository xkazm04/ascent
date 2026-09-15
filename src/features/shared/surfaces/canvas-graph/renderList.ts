// The render list: a cached derivation of (graph, positions, committed camera, viewport, edge
// settings, focus set) — the culled, tiered sequence the canvas paints. Its inputs are NAMED here and
// in the `useMemo` that calls it; nothing else recomputes it (derivation-names-recomputation). Culls
// before it formats: a node outside the overscan costs one rect test, never a label. Edges are culled
// by their OWN geometry, so a long link with both endpoints offscreen still draws where it crosses.

import { rectsIntersect, type Camera, type Pt, type Rect, type Size } from "./camera";
import { visibleRect } from "./camera";
import type { EdgeKind, Graph } from "./fixtures";
import { anchorToward, CULL_MARGIN, edgePath, edgeVisible, LAYER_GAP, NODE_H, NODE_W, ROW_GAP, tierFor, type Tier } from "./geometry";
import type { Positions } from "./graphStore";

export type EdgeSettings = { kinds: ReadonlySet<EdgeKind>; focusContext: boolean; hitWidth: number };
export type DrawnEdge = { id: string; from: string; to: string; kind: EdgeKind; weight: number; d: string; lit: boolean; a: Pt; b: Pt };
export type Column = { layer: number; x: number; y: number; h: number; count: number };
export type Bundle = { id: string; from: number; to: number; count: number; a: Pt; b: Pt };
export type RenderList = {
  tier: Tier;
  view: Rect;
  /** Visible node indices, ranked nearest-to-centre first (the wave fill order). */
  ranked: number[];
  edges: DrawnEdge[];
  columns: Column[];
  bundles: Bundle[];
  totals: { nodes: number; edges: number; edgesConsidered: number };
};

const EMPTY: RenderList = { tier: "full", view: { x: 0, y: 0, w: 0, h: 0 }, ranked: [], edges: [], columns: [], bundles: [], totals: { nodes: 0, edges: 0, edgesConsidered: 0 } };

export function deriveRenderList(graph: Graph, pos: Positions, cam: Camera, size: Size, settings: EdgeSettings, focus: ReadonlySet<string>, measured: boolean): RenderList {
  // Before the viewport has been measured the culled set is EMPTY, not everything.
  if (!measured) return EMPTY;
  const tier = tierFor(cam.z);
  const view = visibleRect(cam, size, CULL_MARGIN);
  if (tier === "bundle") return bundled(graph, cam, size, view);

  const hits: { i: number; d: number }[] = [];
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  for (let i = 0; i < graph.nodes.length; i++) {
    const x = pos.x[i];
    const y = pos.y[i];
    if (x === undefined || y === undefined) continue;
    if (x + NODE_W < view.x || x > view.x + view.w || y + NODE_H < view.y || y > view.y + view.h) continue;
    hits.push({ i, d: Math.hypot(x - cx, y - cy) });
  }
  const ranked = hits.sort((a, b) => a.d - b.d).map((h) => h.i);

  const edges: DrawnEdge[] = [];
  const focused = focus.size > 0 && settings.focusContext;
  let considered = 0;
  for (const e of graph.edges) {
    if (!settings.kinds.has(e.kind)) continue;
    if (tier === "rect" && e.weight < 3) continue; // far out, low-weight edges drop entirely
    considered += 1;
    const ia = pos.at.get(e.from);
    const ib = pos.at.get(e.to);
    if (ia === undefined || ib === undefined) continue;
    const ax = pos.x[ia], ay = pos.y[ia], bx = pos.x[ib], by = pos.y[ib];
    if (ax === undefined || ay === undefined || bx === undefined || by === undefined) continue;
    const pa: Pt = { x: ax, y: ay };
    const pb: Pt = { x: bx, y: by };
    const a = anchorToward(pa, { x: pb.x + NODE_W / 2, y: pb.y + NODE_H / 2 });
    const b = anchorToward(pb, { x: pa.x + NODE_W / 2, y: pa.y + NODE_H / 2 });
    if (!edgeVisible(a, b, view)) continue;
    const lit = !focused || focus.has(e.from) || focus.has(e.to);
    edges.push({ id: e.id, from: e.from, to: e.to, kind: e.kind, weight: e.weight, d: edgePath(a, b), lit, a, b });
  }
  return { tier, view, ranked, edges, columns: [], bundles: [], totals: { nodes: graph.nodes.length, edges: graph.edges.length, edgesConsidered: considered } };
}

/** The far tier: one column per layer, one weighted bundle per adjacent pair — structure, not detail. */
function bundled(graph: Graph, cam: Camera, size: Size, view: Rect): RenderList {
  const rows = Math.ceil(graph.nodes.length / graph.layers);
  const h = rows * ROW_GAP + NODE_H;
  const columns: Column[] = [];
  for (let layer = 0; layer < graph.layers; layer++) {
    const x = layer * LAYER_GAP;
    if (!rectsIntersect({ x, y: 0, w: NODE_W, h }, view)) continue;
    columns.push({ layer, x, y: 0, h, count: Math.min(rows, Math.ceil((graph.nodes.length - layer) / graph.layers)) });
  }
  const counts = new Map<string, number>();
  for (const e of graph.edges) {
    const a = graph.byId.get(e.from);
    const b = graph.byId.get(e.to);
    if (!a || !b || a.layer < 0 || b.layer < 0) continue;
    const key = `${a.layer}>${b.layer}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const bundles: Bundle[] = [];
  for (const [key, count] of counts) {
    const [from, to] = key.split(">").map(Number);
    if (from === undefined || to === undefined) continue;
    const a = { x: from * LAYER_GAP + NODE_W, y: h / 2 };
    const b = { x: to * LAYER_GAP, y: h / 2 };
    if (!rectsIntersect({ x: Math.min(a.x, b.x), y: 0, w: Math.abs(b.x - a.x) + 1, h }, view)) continue;
    bundles.push({ id: key, from, to, count, a, b });
  }
  return { tier: "bundle", view, ranked: [], edges: [], columns, bundles, totals: { nodes: graph.nodes.length, edges: graph.edges.length, edgesConsidered: graph.edges.length } };
}
