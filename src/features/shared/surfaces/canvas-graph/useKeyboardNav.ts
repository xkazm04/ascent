"use client";

// Canvas accessibility: the canvas is ONE focusable region; inside it a roving cursor travels among
// nodes — spatially (arrow = nearest node in that screen direction) or topologically (arrow = along
// the graph: targets, sources, siblings). Focus is not selection: Enter selects. Every pointer
// mutation has a key path — Shift+arrows nudge (one `move` transaction per key gesture), `c` enters a
// connect pick that travels ELIGIBLE targets only, +/-/0 are the zoom and fit keys. The cursor is
// always panned into view, and every landing is announced in graph terms.

import { useCallback, useState, type KeyboardEvent } from "react";
import { rectContains, visibleRect, type Pt } from "./camera";
import type { Graph } from "./fixtures";
import { NODE_H, NODE_W, nodeCenter, worldBounds } from "./geometry";
import { connectValidity, posAt, type GraphAction, type Positions } from "./graphStore";
import type { CameraApi } from "./useCamera";

export type NavMode = "spatial" | "topological";
export type Pick = { from: string; candidates: string[]; index: number };
export const NUDGE = 8;
export const NUDGE_COARSE = 40;

type Deps = { graph: Graph; positions: Positions; selected: ReadonlySet<string>; dispatch: (a: GraphAction) => void; camera: CameraApi; announce: (msg: string) => void; mode: NavMode; onEscape: () => void };

const DIRS: Record<string, Pt> = { ArrowRight: { x: 1, y: 0 }, ArrowLeft: { x: -1, y: 0 }, ArrowDown: { x: 0, y: 1 }, ArrowUp: { x: 0, y: -1 } };

/** Nearest node inside a 90° cone in `dir` from `from` — the spatial axis. O(n), once per key. */
export function spatialNext(graph: Graph, pos: Positions, from: string, dir: Pt): string | null {
  const c = nodeCenter(posAt(pos, from));
  let best: string | null = null;
  let bestD = Infinity;
  for (let i = 0; i < graph.nodes.length; i++) {
    const id = graph.nodes[i].id;
    if (id === from) continue;
    const dx = pos.x[i] + NODE_W / 2 - c.x;
    const dy = pos.y[i] + NODE_H / 2 - c.y;
    const along = dx * dir.x + dy * dir.y;
    if (along <= 0) continue;
    const perp = Math.abs(dx * dir.y - dy * dir.x);
    if (perp > along) continue;
    const d = along + perp * 2;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/** The topological axis: right = first outgoing target, left = first incoming source, down/up = siblings (same layer). */
export function topologicalNext(graph: Graph, from: string, key: string): string | null {
  const n = graph.byId.get(from);
  if (!n) return null;
  if (key === "ArrowRight") return graph.edgeById.get(graph.out.get(from)?.[0] ?? "")?.to ?? null;
  if (key === "ArrowLeft") return graph.edgeById.get(graph.inc.get(from)?.[0] ?? "")?.from ?? null;
  const step = key === "ArrowDown" ? 1 : -1;
  const idx = graph.nodes.indexOf(n);
  const sib = graph.nodes[idx + step * graph.layers];
  return sib && sib.layer === n.layer ? sib.id : null;
}

export function describe(graph: Graph, id: string, selected: ReadonlySet<string>): string {
  const n = graph.byId.get(id);
  if (!n) return id;
  const ins = graph.inc.get(id)?.length ?? 0;
  const outs = graph.out.get(id)?.length ?? 0;
  return `${n.name} — ${n.kind} — ${ins} input${ins === 1 ? "" : "s"}, ${outs} output${outs === 1 ? "" : "s"}${selected.has(id) ? " — selected" : ""}`;
}

export function useKeyboardNav(deps: Deps) {
  const { graph, positions, selected, dispatch, camera, announce, mode, onEscape } = deps;
  const [cursor, setCursorState] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);

  const land = useCallback(
    (id: string) => {
      setCursorState(id);
      const center = nodeCenter(posAt(positions, id));
      if (!rectContains(visibleRect(camera.live.current, camera.size), center)) camera.panTo(center); // focus the user cannot see is focus lost
      announce(describe(graph, id, selected));
    },
    [announce, camera, graph, positions, selected],
  );

  const startPick = useCallback(
    (from: string) => {
      const c = nodeCenter(posAt(positions, from));
      const candidates = graph.nodes
        .filter((n) => n.id !== from && connectValidity(graph, from, n.id).ok)
        .map((n) => ({ id: n.id, d: Math.hypot(posAt(positions, n.id).x - c.x, posAt(positions, n.id).y - c.y) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 24)
        .map((x) => x.id);
      if (candidates.length === 0) return announce("no eligible target");
      setPick({ from, candidates, index: 0 });
      announce(`connect from ${graph.byId.get(from)?.name}: candidate ${graph.byId.get(candidates[0])?.name}, eligible. Enter confirms, Escape cancels`);
    },
    [announce, graph, positions],
  );

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const key = e.key;
    if (pick) {
      if (key === "Escape") {
        setPick(null);
        announce("connection cancelled");
      } else if (key === "Enter") {
        const to = pick.candidates[pick.index];
        dispatch({ type: "connect", from: pick.from, to, kind: graph.byId.get(pick.from)?.kind === "app" ? "deploy" : "import" });
        announce(`connected ${graph.byId.get(pick.from)?.name} to ${graph.byId.get(to)?.name}`);
        setPick(null);
      } else if (key in DIRS || key === "Tab") {
        const dir = key === "ArrowLeft" || key === "ArrowUp" || (key === "Tab" && e.shiftKey) ? -1 : 1;
        const index = (pick.index + dir + pick.candidates.length) % pick.candidates.length;
        setPick({ ...pick, index });
        land(pick.candidates[index]);
      } else return;
      e.preventDefault();
      return;
    }
    if (key === "Escape") {
      onEscape();
      dispatch({ type: "select", ids: [], mode: "clear" });
      return;
    }
    if (key === "+" || key === "=") return camera.zoomBy(1.25);
    if (key === "-") return camera.zoomBy(0.8);
    if (key === "0") return camera.fit(worldBounds(graph));
    if (key === "Home") return land(graph.nodes[0].id);
    const at = cursor ?? graph.nodes[0]?.id;
    if (!at) return;
    if (key in DIRS) {
      e.preventDefault();
      if (e.shiftKey) {
        const step = e.altKey ? NUDGE_COARSE : NUDGE;
        const ids = selected.size > 0 ? [...selected] : [at];
        dispatch({ type: "move", ids, dx: DIRS[key].x * step, dy: DIRS[key].y * step, via: "nudge" }); // one transaction per key gesture
        return announce(`nudged ${ids.length} by ${step}`);
      }
      if (!cursor) return land(at);
      const next = mode === "spatial" ? spatialNext(graph, positions, at, DIRS[key]) : topologicalNext(graph, at, key);
      return next ? land(next) : announce(mode === "spatial" ? "nothing further that way" : "no node along that relationship");
    }
    if (key === "Enter" || key === " ") {
      e.preventDefault();
      dispatch({ type: "select", ids: [at], mode: e.shiftKey ? "toggle" : "replace" });
      const count = e.shiftKey ? (selected.has(at) ? selected.size - 1 : selected.size + 1) : 1;
      return announce(`${count} node${count === 1 ? "" : "s"} selected`);
    }
    if (key === "c") return startPick(at);
  };

  return { cursor, pick, onKeyDown, land, startPick };
}
