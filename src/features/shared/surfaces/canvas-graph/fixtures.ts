// Deterministic fixtures for the canvas-graph scene: a fictional org's repository dependency atlas.
// Seeded (mulberry32) by the volume, so the same knob always yields the same graph — the jsdom test
// and the screenshot see identical worlds. No Math.random, no Date.now, no React. Nodes and edges
// are minted with their own identities at creation (`n-<i>`, `e-<i>`); nothing downstream keys by
// position in an array (identity-survives-reuse).

import type { SurfaceVolume } from "@/lib/org/surface-catalog";

export type NodeKind = "app" | "service" | "lib";
export type EdgeKind = "import" | "deploy" | "reference";

export type GraphNode = { id: string; name: string; kind: NodeKind; layer: number; row: number; score: number };
export type GraphEdge = { id: string; from: string; to: string; kind: EdgeKind; weight: number };

export type Graph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: number;
  byId: Map<string, GraphNode>;
  /** Outgoing / incoming edge ids per node id — the topology the keyboard walks. */
  out: Map<string, string[]>;
  inc: Map<string, string[]>;
  edgeById: Map<string, GraphEdge>;
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEMS = ["alloy", "basalt", "cirrus", "delta", "ember", "fathom", "granite", "harbor", "isobar", "juniper", "kestrel", "lumen", "mica", "nimbus", "orbit", "pumice"];
const SUFFIX: Record<NodeKind, string[]> = { app: ["web", "admin", "mobile", "cli"], service: ["api", "worker", "gateway", "sync"], lib: ["core", "types", "utils", "sdk"] };

/** Layers per volume: a layered (dominant-direction) graph, so the tidy layout is deterministic. */
export function layersFor(volume: number): number {
  return Math.max(3, Math.min(160, Math.round(Math.sqrt(volume / 2))));
}

function kindFor(layer: number, layers: number): NodeKind {
  const q = layer / Math.max(1, layers - 1);
  return q < 0.2 ? "app" : q > 0.7 ? "lib" : "service";
}

/** The base graph for a volume: `volume` nodes across `layersFor(volume)` layers, ~1.4 edges per node. */
export function makeGraph(volume: SurfaceVolume): Graph {
  const rnd = mulberry32(volume);
  const layers = layersFor(volume);
  const rows = Math.ceil(volume / layers);
  const nodes: GraphNode[] = [];
  for (let i = 0; i < volume; i++) {
    const layer = i % layers;
    const row = Math.floor(i / layers);
    const kind = kindFor(layer, layers);
    const stem = STEMS[Math.floor(rnd() * STEMS.length)];
    const sfx = SUFFIX[kind][Math.floor(rnd() * SUFFIX[kind].length)];
    nodes.push({ id: `n-${i}`, name: `${stem}-${sfx}-${String(i + 1).padStart(String(volume).length, "0")}`, kind, layer, row, score: Math.round(20 + rnd() * 80) });
  }
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const link = (from: GraphNode, to: GraphNode | undefined, kind: EdgeKind) => {
    if (!to || to.id === from.id) return;
    const key = `${from.id}>${to.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ id: `e-${edges.length}`, from: from.id, to: to.id, kind, weight: 1 + Math.floor(rnd() * 5) });
  };
  for (const n of nodes) {
    if (n.layer >= layers - 1) continue;
    // One or two edges into the next layer: the dominant direction the layered layout reads.
    const count = rnd() < 0.4 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const row = Math.floor(rnd() * rows);
      link(n, nodes[row * layers + n.layer + 1], n.kind === "app" ? "deploy" : "import");
    }
    // A few long cross-layer references — the edges that make a hairball when always drawn.
    if (rnd() < 0.06 && n.layer + 2 < layers) {
      const layer = n.layer + 2 + Math.floor(rnd() * (layers - n.layer - 2));
      const row = Math.floor(rnd() * rows);
      link(n, nodes[row * layers + layer], "reference");
    }
  }
  return index(nodes, edges, layers);
}

/** Build the lookups for a node/edge list; also used when the store adds nodes and edges. */
export function index(nodes: GraphNode[], edges: GraphEdge[], layers: number): Graph {
  const byId = new Map<string, GraphNode>();
  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  const edgeById = new Map<string, GraphEdge>();
  for (const n of nodes) byId.set(n.id, n);
  for (const e of edges) {
    edgeById.set(e.id, e);
    (out.get(e.from) ?? out.set(e.from, []).get(e.from))!.push(e.id);
    (inc.get(e.to) ?? inc.set(e.to, []).get(e.to))!.push(e.id);
  }
  return { nodes, edges, layers, byId, out, inc, edgeById };
}

/** The scene's own vocabulary of edge kinds — one place, so filters and legends cannot disagree. */
export const EDGE_KINDS: readonly EdgeKind[] = ["import", "deploy", "reference"];
export const NODE_KINDS: readonly NodeKind[] = ["app", "service", "lib"];
