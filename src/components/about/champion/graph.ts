// Contributor graph + propagation schedule for the "Spread what works" Remotion composition.
// Champions are BFS sources; the practice wave reaches each node at INTRO + distance·STEP, and each
// link heals once the wave reaches its nearer endpoint. Nodes unreachable from any champion (an
// isolated cluster) never heal — they're the weak links that remain. All deterministic → identical
// every render/frame.

export const HEAL = 72; // frames for a link to transition weak → strong (~30% of the original speed)
const INTRO = 73;
const STEP = 56; // frames per BFS hop

export interface GNode {
  x: number;
  y: number;
  champion: boolean;
}

// Top strip (y < 160) is kept clear of nodes so the larger overlaid labels sit over empty canvas.
export const NODES: GNode[] = [
  { x: 250, y: 250, champion: true },
  { x: 610, y: 230, champion: true },
  { x: 120, y: 360, champion: false },
  { x: 380, y: 165, champion: false },
  { x: 430, y: 335, champion: false },
  { x: 600, y: 365, champion: false },
  { x: 760, y: 295, champion: false },
  { x: 270, y: 450, champion: false },
  { x: 515, y: 215, champion: false },
  { x: 800, y: 200, champion: false },
  { x: 660, y: 445, champion: false },
  { x: 790, y: 455, champion: false }, // isolated cluster ↓ (stays weak)
  { x: 875, y: 410, champion: false },
  { x: 845, y: 495, champion: false },
];

const LINK_PAIRS: [number, number][] = [
  [0, 2], [0, 3], [0, 4], [0, 7], [0, 8],
  [1, 3], [1, 8], [1, 5], [1, 9], [1, 6],
  [4, 5], [4, 7], [5, 6], [8, 5], [5, 10],
  [11, 12], [12, 13],
];

function bfsDist(): number[] {
  const adj: number[][] = NODES.map(() => []);
  for (const [a, b] of LINK_PAIRS) {
    adj[a]!.push(b);
    adj[b]!.push(a);
  }
  const dist = NODES.map(() => Infinity);
  const q: number[] = [];
  NODES.forEach((n, i) => {
    if (n.champion) {
      dist[i] = 0;
      q.push(i);
    }
  });
  while (q.length) {
    const u = q.shift()!;
    for (const v of adj[u]!) {
      if (dist[v] === Infinity) {
        dist[v] = dist[u]! + 1;
        q.push(v);
      }
    }
  }
  return dist;
}

const DIST = bfsDist();

export interface GLink {
  from: number; // pulse origin (the endpoint nearer a champion)
  to: number;
  healStart: number;
  reachable: boolean;
}

export const GLINKS: GLink[] = LINK_PAIRS.map(([a, b], i) => {
  const da = DIST[a]!;
  const db = DIST[b]!;
  const reachable = Number.isFinite(Math.min(da, db));
  const from = da <= db ? a : b;
  const to = from === a ? b : a;
  const healStart = reachable ? INTRO + Math.min(da, db) * STEP + (i % 5) * 20 : Infinity;
  return { from, to, healStart, reachable };
});

export const NODE_ADOPT: number[] = DIST.map((d) => (Number.isFinite(d) ? INTRO + d * STEP : Infinity));
