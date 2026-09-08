"use client";

// The canvas-graph showcase: a dependency atlas of a fictional org's repositories — a pan/zoom node
// surface a viewer can explore, rearrange and rewire for a minute — with five instruments around it,
// one per technique of the registry subject, each a region carrying `data-technique="<slug>"`.
// `reduced` and `volume` come from props (never a media query here): reduced turns every camera
// flight into a cut; volume sizes the world (50 / 5,000 / 50,000 nodes) that culling renders a
// window of. No framer-motion: the only motion is the camera, and the camera is the subject.

import { useCallback, useMemo, useReducer, useState } from "react";
import type { SurfaceSceneProps } from "../surfaceBody";
import { A11yPanel } from "./A11yPanel";
import { BudgetPanel } from "./BudgetPanel";
import { CanvasRegion } from "./CanvasRegion";
import { EdgePanel } from "./EdgePanel";
import { fitTo, toWorld, type Camera } from "./camera";
import { makeGraph, type Graph, type NodeKind } from "./fixtures";
import { LAYER_GAP, NODE_H, NODE_W, nodeBounds, ROW_GAP, worldBounds } from "./geometry";
import { derivePositions, initialState, liveGraph, reduce, type GraphAction, type GraphState } from "./graphStore";
import { LayoutPanel } from "./LayoutPanel";
import { ManipulationPanel } from "./ManipulationPanel";
import { deriveRenderList, type EdgeSettings } from "./renderList";
import { useCamera } from "./useCamera";
import { useKeyboardNav, type NavMode } from "./useKeyboardNav";
import { useNodeGestures } from "./useNodeGestures";
import { useWavedMount } from "./useWavedMount";

/** The first framing: the home cluster (five layers, six rows) at full detail, not the whole world. */
function initialCamera(base: Graph): Camera {
  const w = worldBounds(base);
  return fitTo({ x: 0, y: 0, w: Math.min(w.w, 4 * LAYER_GAP + NODE_W), h: Math.min(w.h, 5 * ROW_GAP + NODE_H) }, { w: 800, h: 480 });
}

export function Scene({ reduced, volume }: SurfaceSceneProps) {
  return (
    <div className="space-y-3" data-scene="canvas-graph" data-reduced={reduced}>
      <p className="type-caption text-slate-500">
        Fixture data: <span className="text-slate-300">{volume.toLocaleString()}</span> fictional repositories and their dependencies, seeded; the canvas renders the window the camera shows. Nothing here is an Ascent org.
      </p>
      {/* Keyed on volume: a new world is a new atlas with its own first framing, not a hand-reset. */}
      <Atlas key={volume} reduced={reduced} volume={volume} />
    </div>
  );
}

function Atlas({ reduced, volume }: Pick<SurfaceSceneProps, "reduced" | "volume">) {
  const base = useMemo(() => makeGraph(volume), [volume]);
  const [state, dispatch] = useReducer((s: GraphState, a: GraphAction) => reduce(s, a, base), null, initialState);
  // Named derivations: the live graph recomputes when the canvas creates a node or an edge; the
  // positions when a placement, or the layout run, changes — never "whenever anything re-renders".
  const graph = useMemo(() => liveGraph(base, state), [base, state.extraNodes, state.extraEdges]); // eslint-disable-line react-hooks/exhaustive-deps
  const positions = useMemo(() => derivePositions(graph, state), [graph, state.placed, state.layoutRun]); // eslint-disable-line react-hooks/exhaustive-deps

  const camera = useCamera(reduced, useMemo(() => initialCamera(base), [base]));
  const [settings, setSettings] = useState<EdgeSettings>({ kinds: new Set(["import", "deploy"]), focusContext: true, hitWidth: 8 });
  const [hover, setHover] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [mode, setMode] = useState<NavMode>("spatial");
  const [message, setMessage] = useState("");
  const announce = useCallback((m: string) => setMessage(m), []);

  const gestures = useNodeGestures({ graph, positions, selected: state.selected, dispatch, camera, announce });
  const nav = useKeyboardNav({ graph, positions, selected: state.selected, dispatch, camera, announce, mode, onEscape: gestures.cancel });

  const focus = useMemo(() => {
    const s = new Set(state.selected);
    if (hover) s.add(hover);
    if (nav.cursor) s.add(nav.cursor);
    return s;
  }, [state.selected, hover, nav.cursor]);
  const list = useMemo(
    () => deriveRenderList(graph, positions, camera.cam, camera.size, settings, focus, camera.measured),
    [graph, positions, camera.cam, camera.size, settings, focus, camera.measured],
  );
  const wave = useWavedMount(list.ranked.length);
  const focusNode = hover ?? nav.cursor ?? [...state.selected][0] ?? null;

  const addNode = (kind: NodeKind) => {
    const at = toWorld(camera.cam, { x: camera.size.w / 2 - NODE_W / 2, y: camera.size.h / 2 - NODE_H / 2 });
    const occupied = list.ranked.flatMap((i) => {
      const x = positions.x[i];
      const y = positions.y[i];
      return x === undefined || y === undefined ? [] : [nodeBounds({ x, y })];
    });
    dispatch({ type: "add-node", kind, near: focusNode, at, occupied });
    announce(`added a ${kind} ${focusNode ? "beside the focused node" : "in view"}`);
  };
  const onBackgroundClick = () => {
    dispatch({ type: "select", ids: [], mode: "clear" });
    setSelectedEdge(null);
  };

  return (
    <div className="space-y-3">
      <CanvasRegion
        camera={camera}
        graph={graph}
        positions={positions}
        list={list}
        mounted={wave.mounted}
        selected={state.selected}
        cursor={nav.cursor}
        connect={gestures.connect}
        node={gestures.node}
        port={gestures.port}
        provisionalRef={gestures.provisionalRef}
        onHover={setHover}
        onKeyDown={nav.onKeyDown}
        onBackgroundClick={onBackgroundClick}
        selectedEdge={selectedEdge}
        onSelectEdge={setSelectedEdge}
        hitWidth={settings.hitWidth}
        phase={gestures.phase !== "idle" ? gestures.phase : camera.phase}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <BudgetPanel list={list} mounted={wave.mounted} waves={wave.waves} waveSize={wave.waveSize} zoom={camera.cam.z} measured={camera.measured} />
        <ManipulationPanel drag={gestures.phase} pan={camera.phase} connect={gestures.connect} history={state.history} selectedCount={state.selected.size} onCancel={gestures.cancel} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <LayoutPanel state={state} total={graph.nodes.length} onRelayout={() => dispatch({ type: "relayout" })} onReset={() => dispatch({ type: "reset" })} onAddNode={addNode} />
        <EdgePanel graph={graph} settings={settings} onSettings={setSettings} list={list} focus={focusNode} selectedEdge={selectedEdge} />
        <A11yPanel graph={graph} cursor={nav.cursor} selected={state.selected} mode={mode} onMode={setMode} message={message} pick={nav.pick} onJump={nav.land} />
      </div>
    </div>
  );
}
