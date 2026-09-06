// The declarative truth of the atlas: which positions the user placed (provenance), which layout run
// the generated ones derive from, the edges and nodes created on the canvas, the selection, and one
// history entry per completed gesture. Every mutation is a named transition through this reducer —
// the gesture layer stays provisional until commit, so a cancelled drag never touched the model and a
// finished one is exactly one transaction. Pure; no React beyond the reducer signature.

import type { Pt, Rect } from "./camera";
import { index, type EdgeKind, type Graph, type GraphEdge, type GraphNode, type NodeKind } from "./fixtures";
import { generatedPosition, placeNear } from "./geometry";

export type Provenance = "user" | "generated";
export type Placed = { x: number; y: number; provenance: Provenance };

/** The persisted layout document — versioned, keyed by durable node identity, written per gesture. */
export const LAYOUT_DOC_VERSION = 2;

export type GraphState = {
  placed: Map<string, Placed>;
  layoutRun: number;
  extraNodes: GraphNode[];
  extraEdges: GraphEdge[];
  selected: ReadonlySet<string>;
  /** Most recent first; each entry is one gesture = one undoable transaction. */
  history: string[];
  nextId: number;
};

export type GraphAction =
  | { type: "move"; ids: string[]; dx: number; dy: number; via: "drag" | "nudge" }
  | { type: "connect"; from: string; to: string; kind: EdgeKind }
  | { type: "select"; ids: string[]; mode: "replace" | "toggle" | "clear" }
  | { type: "relayout" }
  | { type: "reset" }
  | { type: "add-node"; kind: NodeKind; near: string | null; at: Pt; occupied: Rect[] };

export const initialState = (): GraphState => ({ placed: new Map(), layoutRun: 0, extraNodes: [], extraEdges: [], selected: new Set(), history: [], nextId: 0 });

const withHistory = (s: GraphState, entry: string, patch: Partial<GraphState>): GraphState => ({ ...s, ...patch, history: [entry, ...s.history].slice(0, 6) });

export function reduce(s: GraphState, a: GraphAction, base: Graph): GraphState {
  switch (a.type) {
    case "move": {
      // The moment the user moves a node its position flips to user-authored and stays there.
      const placed = new Map(s.placed);
      for (const id of a.ids) {
        const cur = positionOf(id, s, base);
        placed.set(id, { x: cur.x + a.dx, y: cur.y + a.dy, provenance: "user" });
      }
      return withHistory(s, `${a.via} ${a.ids.length} node${a.ids.length === 1 ? "" : "s"} by (${Math.round(a.dx)}, ${Math.round(a.dy)})`, { placed });
    }
    case "connect": {
      const edge: GraphEdge = { id: `e-x${s.nextId}`, from: a.from, to: a.to, kind: a.kind, weight: 3 };
      return withHistory(s, `connect ${a.from} → ${a.to} (${a.kind})`, { extraEdges: [...s.extraEdges, edge], nextId: s.nextId + 1 });
    }
    case "select": {
      if (a.mode === "clear") return s.selected.size === 0 ? s : { ...s, selected: new Set() };
      if (a.mode === "replace") return { ...s, selected: new Set(a.ids) };
      const next = new Set(s.selected);
      for (const id of a.ids) if (next.has(id)) next.delete(id); else next.add(id);
      return { ...s, selected: next };
    }
    case "relayout":
      // Generated positions re-flow; user-authored ones are fixed anchors the algorithm may not touch.
      return withHistory(s, `re-layout (run ${s.layoutRun + 1}; ${countUser(s)} anchors held)`, { layoutRun: s.layoutRun + 1 });
    case "reset":
      // The deliberate, confirmed doorway back to all-generated — one transaction, because it destroys spatial memory.
      return withHistory(s, `reset layout (${countUser(s)} user placements dropped)`, { placed: new Map([...s.placed].filter(([, p]) => p.provenance !== "user")) });
    case "add-node": {
      const id = `n-x${s.nextId}`;
      const nearPos = a.near ? positionOf(a.near, s, base) : null;
      const at = placeNear(nearPos ?? a.at, a.occupied);
      const node: GraphNode = { id, name: `new-${a.kind}-${s.nextId + 1}`, kind: a.kind, layer: -1, row: -1, score: 50 };
      const placed = new Map(s.placed).set(id, { ...at, provenance: "generated" });
      const extraEdges = a.near ? [...s.extraEdges, { id: `e-x${s.nextId}`, from: a.near, to: id, kind: "import" as const, weight: 2 }] : s.extraEdges;
      return withHistory(s, `add ${node.name} ${a.near ? `beside ${a.near}` : "in view"}`, { extraNodes: [...s.extraNodes, node], extraEdges, placed, nextId: s.nextId + 1, selected: new Set([id]) });
    }
  }
}

export const countUser = (s: GraphState): number => [...s.placed.values()].filter((p) => p.provenance === "user").length;

/** The one door for "where is this node": a stored placement wins, otherwise the layout derivation. */
export function positionOf(id: string, s: GraphState, base: Graph): Pt {
  const p = s.placed.get(id);
  if (p) return p;
  const n = base.byId.get(id);
  return n ? generatedPosition(n, s.layoutRun) : { x: 0, y: 0 };
}

/** The live graph: the seeded base plus what the canvas created. Recomputed when either changes. */
export function liveGraph(base: Graph, s: GraphState): Graph {
  if (s.extraNodes.length === 0 && s.extraEdges.length === 0) return base;
  return index([...base.nodes, ...s.extraNodes], [...base.edges, ...s.extraEdges], base.layers);
}

/** Positions as typed arrays indexed like `graph.nodes` — the culling loop reads these, not a Map per node. */
export type Positions = { x: Float64Array; y: Float64Array; at: Map<string, number> };

export function derivePositions(graph: Graph, s: GraphState): Positions {
  const n = graph.nodes.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const at = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const node = graph.nodes[i];
    if (!node) continue;
    const p = s.placed.get(node.id) ?? generatedPosition(node, s.layoutRun);
    x[i] = p.x;
    y[i] = p.y;
    at.set(node.id, i);
  }
  return { x, y, at };
}

export const posAt = (pos: Positions, id: string): Pt => {
  const i = pos.at.get(id);
  return i === undefined ? { x: 0, y: 0 } : { x: pos.x[i] ?? 0, y: pos.y[i] ?? 0 };
};

/** Live validity of a connection — shown during the hover, never as a rejection after release. */
export function connectValidity(graph: Graph, from: string, to: string): { ok: boolean; reason: string } {
  if (from === to) return { ok: false, reason: "self-loop" };
  const a = graph.byId.get(from);
  const b = graph.byId.get(to);
  if (!a || !b) return { ok: false, reason: "unknown node" };
  if (a.kind === "lib" && b.kind === "app") return { ok: false, reason: "a lib may not depend on an app" };
  for (const eid of graph.out.get(from) ?? []) if (graph.edgeById.get(eid)?.to === to) return { ok: false, reason: "duplicate edge" };
  for (const eid of graph.out.get(to) ?? []) if (graph.edgeById.get(eid)?.to === from) return { ok: false, reason: "would form a cycle" };
  return { ok: true, reason: "eligible" };
}
