// Source excerpts for the mechanism drawer — verbatim from the scene's own files (camera.ts,
// useCamera.ts, renderList.ts, useNodeGestures.ts, graphStore.ts, geometry.ts, useKeyboardNav.ts).
// String constants so the drawer needs no build step; when the code moves, these move with it.

export const SRC_VIEWPORT = `// camera.ts — the one authority; nothing else multiplies or divides by z
export const toScreen = (cam, p) => ({ x: p.x * cam.z + cam.x, y: p.y * cam.z + cam.y });
export const toWorld  = (cam, p) => ({ x: (p.x - cam.x) / cam.z, y: (p.y - cam.y) / cam.z });
export function zoomAt(cam, pivot, nextZ) {           // written once; wheel, keys and buttons differ only in the pivot
  const w = toWorld(cam, pivot);
  const z = clampZ(nextZ);                            // clamped HERE, never at a call site
  return { z, x: pivot.x - w.x * z, y: pivot.y - w.y * z };
}
// useCamera.ts — the gesture loan: imperative mid-gesture, committed per frame / on release, re-asserted after any render
live.current = { ...g.start, x: g.start.x + dx, y: g.start.y + dy };   // origin + delta, never accumulated
applyLive();                                                          // worldRef.setAttribute("transform", camTransform(live))
if (Math.hypot(e.clientX - g.lastCommit.x, e.clientY - g.lastCommit.y) > (CULL_MARGIN / 2) * live.current.z) commit();
useLayoutEffect(() => { if (gesture.current?.panning || flight.current) applyLive(); });   // the reconciliation guard
el.addEventListener("wheel", onWheel, { passive: false });           // native + non-passive, on the svg that owns the pixels`;

export const SRC_BUDGET = `// renderList.ts — a named derivation: f(graph, positions, camera, viewport, settings, focus)
if (!measured) return EMPTY;                          // before the viewport is measured: empty, not everything
const view = visibleRect(cam, size, CULL_MARGIN);     // the overscan, from the authority
for (let i = 0; i < graph.nodes.length; i++) {        // cull BEFORE formatting: a rect test, never a label
  if (x + NODE_W < view.x || x > view.x + view.w || y + NODE_H < view.y || y > view.y + view.h) continue;
  hits.push({ i, d: Math.hypot(x - cx, y - cy) });    // ranked nearest-to-centre: the wave fill order
}
if (!edgeVisible(a, b, view)) continue;               // an edge is culled by ITS geometry, not its endpoints
// NodeView.tsx — memoized on its own record; the camera never reaches it
export const NodeView = memo(function NodeView({ id, x, y, selected, cursor, node, port }) { … <g transform={\`translate(\${x} \${y})\`} {...node}> … });
// CanvasRegion.tsx — the world <g> carries the transform AND the zoom-detail properties nodes inherit without a render
<g ref={camera.worldRef} transform={camTransform(cam)} style={{ "--label-scale": labelScale(cam.z), "--label-opacity": lod(cam.z, DETAIL_Z, DETAIL_Z + 0.2) }}>`;

export const SRC_MANIPULATION = `// useNodeGestures.ts — capture at press on the node (it is the whole target); a screen-space threshold decides
e.currentTarget.setPointerCapture?.(e.pointerId);     // the drag outlives the element under the pointer
if (!d.moving) {
  if (Math.hypot(dx, dy) < SLOP_PX) return;           // a press is a click until it travels — no model write before this
  d.moving = true;
}
const w = worldDelta(latest.current.camera.live.current, dx, dy);   // through the authority: tracks the cursor at any zoom
el.setAttribute("transform", \`translate(\${start.x + w.x} \${start.y + w.y})\`);   // provisional, imperative
// release: the threshold never crossed → a click (select); crossed → ONE transaction
if (!d.moving) dispatch({ type: "select", ids: [id], mode: e.shiftKey ? "toggle" : "replace" });
else dispatch({ type: "move", ids: d.ids, dx: w.x, dy: w.y, via: "drag" });
// connect: provisional edge from the port, validity shown live, release elsewhere cancels
const under = nodeIdOf(document.elementFromPoint(e.clientX, e.clientY));   // captured pointer: hit-test, not pointerenter
setConnect({ from: c.from, target: under, ok: v.ok, reason: v.reason });
// useCamera.ts — the SEA captures at the threshold, not at press, so child clicks keep firing
g.panning = true; e.currentTarget.setPointerCapture?.(e.pointerId);
suppressClick.current = true;                          // the platform still synthesizes a click from this press`;

export const SRC_LAYOUT = `// graphStore.ts — provenance decides what the algorithm may touch
case "move":   placed.set(id, { x, y, provenance: "user" });   // the moment the user moves a node it stays user-authored
case "relayout": return { ...s, layoutRun: s.layoutRun + 1 }; // generated re-flow; user placements are anchors
case "reset":    placed = new Map([...s.placed].filter(([, p]) => p.provenance !== "user"));   // confirmed, one transaction
export function positionOf(id, s, base) {             // the one door: stored placement, else the layout derivation
  return s.placed.get(id) ?? generatedPosition(base.byId.get(id), s.layoutRun);
}
// geometry.ts — layered, deterministic: same graph in, same layout out
export function generatedPosition(n, run) { return { x: n.layer * LAYER_GAP, y: n.row * ROW_GAP + stagger }; }
export function placeNear(from, occupied) {           // the placement policy: beside the neighbour, probing outward, never the origin
  const first = { x: from.x + LAYER_GAP, y: from.y };
  if (clear(first)) return first;
  for (let ring = 1; ring <= fallbackRings; ring++) { … }
}
export const LAYOUT_DOC_VERSION = 2;                  // versioned, keyed by node id, written per completed gesture`;

export const SRC_EDGES = `// geometry.ts — ONE bounds + ONE anchor function, read by nodes, edges, hit-tests, culling and layout
export const nodeBounds = (p) => ({ x: p.x, y: p.y, w: NODE_W, h: NODE_H });
export function anchorToward(p, toward) {             // the boundary point facing the other endpoint — recomputed as nodes move
  const c = nodeCenter(p); const dx = toward.x - c.x; const dy = toward.y - c.y;
  const s = Math.min(NODE_W / 2 / Math.abs(dx), NODE_H / 2 / Math.abs(dy));
  return { x: c.x + dx * s, y: c.y + dy * s };
}
// renderList.ts — the economy: kinds one at a time, focus-context, low weight drops far out
if (!settings.kinds.has(e.kind)) continue;
if (tier === "rect" && e.weight < 3) continue;
const lit = !focused || focus.has(e.from) || focus.has(e.to);
// EdgeLayer.tsx — a fat invisible stroke over the same path is what the pointer presses
<path d={e.d} strokeOpacity={e.lit ? 0.7 : 0.08} markerEnd={full && e.lit ? "url(#cg-arrow)" : undefined} pointerEvents="none" />
<path d={e.d} stroke="transparent" strokeWidth={hitWidth / zoom} onClick={() => onSelectEdge(e.id)} />`;

export const SRC_A11Y = `// CanvasRegion.tsx — ONE focusable region with a name that counts the graph; the cursor is aria-activedescendant
<svg tabIndex={0} role="application" aria-label={\`Dependency atlas, \${nodes} repositories, \${edges} connections\`}
     aria-activedescendant={cursor ? \`cg-node-\${cursor}\` : undefined} onKeyDown={nav.onKeyDown}>
// useKeyboardNav.ts — spatial OR topological travel; focus is not selection; every landing announced and panned into view
const next = mode === "spatial" ? spatialNext(graph, positions, at, DIRS[key]) : topologicalNext(graph, at, key);
if (!rectContains(visibleRect(camera.live.current, camera.size), center)) camera.panTo(center);
announce(describe(graph, id, selected));               // "name — kind — 2 inputs, 3 outputs — selected"
if (key === "Enter") dispatch({ type: "select", ids: [at], mode: e.shiftKey ? "toggle" : "replace" });
if (e.shiftKey) dispatch({ type: "move", ids, dx: DIRS[key].x * step, dy: DIRS[key].y * step, via: "nudge" });   // one transaction per key
if (key === "c") startPick(at);                        // the pick travels ELIGIBLE targets only (connectValidity)
// useCamera.ts — programmatic travel is a cut under reduced motion
if (reduced) { live.current = target; applyLive(); commit(); return; }`;
