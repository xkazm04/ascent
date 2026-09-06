"use client";

// Direct manipulation: node drag (pointer capture at press — the node IS the gesture target; a
// screen-space movement threshold decides click vs drag; the drag is origin + converted delta, written
// imperatively to the dragged <g>s, committed as ONE `move` transaction on release) and the connect
// gesture (a provisional edge from a port, target validity shown live, release anywhere else cancels).
// Escape cancels either with the model untouched: nothing here writes to the store before commit.
// Every handler is referentially stable and reads the node's identity from `data-node-id`, so the
// memoized nodes never see a fresh closure (render-budget rung 3).

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { toWorld, worldDelta, type Pt } from "./camera";
import type { EdgeKind, Graph } from "./fixtures";
import { anchorToward, edgePath, nodeCenter } from "./geometry";
import { connectValidity, posAt, type GraphAction, type Positions } from "./graphStore";
import { SLOP_PX, type CameraApi } from "./useCamera";

export type DragPhase = "idle" | "press" | "drag" | "connect";
export type ConnectState = { from: string; target: string | null; ok: boolean; reason: string };

type Deps = { graph: Graph; positions: Positions; selected: ReadonlySet<string>; dispatch: (a: GraphAction) => void; camera: CameraApi; announce: (msg: string) => void };
type Drag = { ids: string[]; els: { el: Element; start: Pt }[]; ox: number; oy: number; moving: boolean; pointerId: number; target: Element; lastDx?: number; lastDy?: number };
type Connect = { from: string; pointerId: number; target: Element; last: string | null };

const nodeIdOf = (el: EventTarget | null): string | null => (el instanceof Element ? el.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId ?? null : null);

export function useNodeGestures(deps: Deps) {
  const latest = useRef(deps);
  useLayoutEffect(() => {
    latest.current = deps; // latest closure behind stable handlers (the useEvent pattern)
  });
  const [phase, setPhase] = useState<DragPhase>("idle");
  const [connect, setConnect] = useState<ConnectState | null>(null);
  const drag = useRef<Drag | null>(null);
  const conn = useRef<Connect | null>(null);
  const provisionalRef = useRef<SVGPathElement>(null);

  const placeDragged = (dx: number, dy: number) => {
    const d = drag.current;
    if (!d) return;
    const w = worldDelta(latest.current.camera.live.current, dx, dy);
    for (const { el, start } of d.els) el.setAttribute("transform", `translate(${start.x + w.x} ${start.y + w.y})`);
  };
  // The loan guard: a render mid-drag (hover elsewhere, an interim camera commit) would reconcile the
  // dragged <g> back to its stale committed position; re-assert the provisional one after every render.
  useLayoutEffect(() => {
    const d = drag.current;
    if (d?.moving) placeDragged(d.lastDx ?? 0, d.lastDy ?? 0);
  });

  const onNodePointerDown = useCallback((e: RPointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // the surface never sees presses that belong to a node
    const id = nodeIdOf(e.currentTarget);
    if (!id) return;
    const { selected, positions, camera } = latest.current;
    const ids = selected.has(id) ? [...selected] : [id];
    const svg = camera.svgRef.current;
    const els = ids.map((nid) => ({ el: svg?.querySelector(`[data-node-id="${nid}"]`), start: posAt(positions, nid) })).filter((x): x is { el: Element; start: Pt } => !!x.el);
    drag.current = { ids, els, ox: e.clientX, oy: e.clientY, moving: false, pointerId: e.pointerId, target: e.currentTarget };
    e.currentTarget.setPointerCapture?.(e.pointerId); // the drag outlives the element under the pointer
    setPhase("press");
  }, []);

  const onNodePointerMove = useCallback((e: RPointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.ox;
    const dy = e.clientY - d.oy;
    if (!d.moving) {
      if (Math.hypot(dx, dy) < SLOP_PX) return; // a press is a click until it travels — no model write before this
      d.moving = true;
      setPhase("drag");
    }
    d.lastDx = dx;
    d.lastDy = dy;
    placeDragged(dx, dy);
  }, []);

  const finishDrag = (e: RPointerEvent<SVGGElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    d.target.releasePointerCapture?.(d.pointerId);
    const { dispatch, announce } = latest.current;
    if (!d.moving) {
      // The threshold was never crossed: this press is a click. Focus travelled; selection is the explicit act.
      const id = nodeIdOf(e.currentTarget);
      if (id && !cancelled) dispatch({ type: "select", ids: [id], mode: e.shiftKey ? "toggle" : "replace" });
    } else if (cancelled) {
      for (const { el, start } of d.els) el.setAttribute("transform", `translate(${start.x} ${start.y})`);
      announce("drag cancelled; nodes returned");
    } else {
      const w = worldDelta(latest.current.camera.live.current, d.lastDx ?? 0, d.lastDy ?? 0);
      dispatch({ type: "move", ids: d.ids, dx: w.x, dy: w.y, via: "drag" });
      announce(`moved ${d.ids.length} node${d.ids.length === 1 ? "" : "s"}`);
    }
    setPhase("idle");
  };
  const onNodePointerUp = useCallback((e: RPointerEvent<SVGGElement>) => finishDrag(e, false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const drawProvisional = (from: string, to: Pt) => {
    const { positions } = latest.current;
    const a = posAt(positions, from);
    provisionalRef.current?.setAttribute("d", edgePath(anchorToward(a, to), to));
  };

  const onPortPointerDown = useCallback((e: RPointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const from = nodeIdOf(e.currentTarget);
    if (!from) return;
    conn.current = { from, pointerId: e.pointerId, target: e.currentTarget, last: null };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setConnect({ from, target: null, ok: false, reason: "drag to a node" });
    setPhase("connect");
    drawProvisional(from, nodeCenter(posAt(latest.current.positions, from)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onPortPointerMove = useCallback((e: RPointerEvent<SVGElement>) => {
    const c = conn.current;
    if (!c) return;
    const { camera, graph } = latest.current;
    const box = camera.svgRef.current?.getBoundingClientRect();
    const world = toWorld(camera.live.current, { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) });
    drawProvisional(c.from, world);
    // With the pointer captured, nothing else hears pointerenter: hit-test under the cursor instead.
    const under = typeof document.elementFromPoint === "function" ? nodeIdOf(document.elementFromPoint(e.clientX, e.clientY)) : null;
    if (under === c.last) return;
    c.last = under;
    const v = under ? connectValidity(graph, c.from, under) : { ok: false, reason: "drag to a node" };
    setConnect({ from: c.from, target: under, ok: v.ok, reason: v.reason });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finishConnect = (cancelled: boolean) => {
    const c = conn.current;
    if (!c) return;
    conn.current = null;
    c.target.releasePointerCapture?.(c.pointerId);
    provisionalRef.current?.setAttribute("d", "");
    const { dispatch, graph, announce } = latest.current;
    const v = c.last && !cancelled ? connectValidity(graph, c.from, c.last) : null;
    if (v?.ok && c.last) {
      const kind: EdgeKind = graph.byId.get(c.from)?.kind === "app" ? "deploy" : "import";
      dispatch({ type: "connect", from: c.from, to: c.last, kind });
      announce(`connected ${graph.byId.get(c.from)?.name} to ${graph.byId.get(c.last)?.name}`);
    } else announce(cancelled ? "connection cancelled" : "released off target; no edge created");
    setConnect(null);
    setPhase("idle");
  };
  const onPortPointerUp = useCallback(() => finishConnect(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Escape: the in-flight gesture ends with the model untouched. */
  const cancel = useCallback(() => {
    if (drag.current) finishDrag({ currentTarget: drag.current.target, shiftKey: false } as unknown as RPointerEvent<SVGGElement>, true);
    if (conn.current) finishConnect(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // One stable handler bundle for every node: memoized nodes compare it by reference.
  const node = useMemo(() => ({ onPointerDown: onNodePointerDown, onPointerMove: onNodePointerMove, onPointerUp: onNodePointerUp, onPointerCancel: onNodePointerUp }), [onNodePointerDown, onNodePointerMove, onNodePointerUp]);
  const port = useMemo(() => ({ onPointerDown: onPortPointerDown, onPointerMove: onPortPointerMove, onPointerUp: onPortPointerUp, onPointerCancel: onPortPointerUp }), [onPortPointerDown, onPortPointerMove, onPortPointerUp]);
  return { phase, connect, provisionalRef, node, port, cancel };
}

export type NodeHandlers = ReturnType<typeof useNodeGestures>["node"];
export type PortHandlers = ReturnType<typeof useNodeGestures>["port"];
