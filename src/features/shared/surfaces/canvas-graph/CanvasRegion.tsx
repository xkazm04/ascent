"use client";

// The canvas itself — the viewport-transform region. One svg owns the pointer stream and the wheel;
// one world <g> carries the camera (imperatively mid-gesture, declaratively at commit) and the two
// zoom-detail custom properties the memoized nodes inherit. Zoom and fit are real buttons routed
// through the same `zoomAt` as the wheel, pinned to the viewport centre. The svg is ONE focusable
// region with an accessible name that counts the graph; the keyboard hook owns what happens inside.

import type { KeyboardEvent } from "react";
import type { Graph } from "./fixtures";
import { DETAIL_Z, labelScale, lod, NODE_H, NODE_W, worldBounds } from "./geometry";
import type { Positions } from "./graphStore";
import { camTransform } from "./camera";
import { EdgeLayer } from "./EdgeLayer";
import { NodeView } from "./NodeView";
import type { RenderList } from "./renderList";
import { BTN, Readout, Region } from "./sceneParts";
import type { CameraApi, CameraStats } from "./useCamera";
import type { ConnectState, NodeHandlers, PortHandlers } from "./useNodeGestures";

export type CanvasProps = {
  camera: CameraApi;
  graph: Graph;
  positions: Positions;
  list: RenderList;
  mounted: number;
  selected: ReadonlySet<string>;
  cursor: string | null;
  connect: ConnectState | null;
  node: NodeHandlers;
  port: PortHandlers;
  provisionalRef: React.RefObject<SVGPathElement | null>;
  onHover: (id: string | null) => void;
  onKeyDown: (e: KeyboardEvent<SVGSVGElement>) => void;
  onBackgroundClick: () => void;
  selectedEdge: string | null;
  onSelectEdge: (id: string | null) => void;
  hitWidth: number;
  phase: string;
};

export function CanvasRegion(p: CanvasProps) {
  const { camera, graph, positions, list, mounted, selected, cursor, connect, provisionalRef, phase } = p;
  const { cam, svgRef, worldRef, handlers, stats } = camera;
  const full = list.tier === "full";
  const shown = list.ranked.slice(0, mounted);
  const fitSelection = () => {
    if (selected.size === 0) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of selected) {
      const i = positions.at.get(id);
      const x = i === undefined ? undefined : positions.x[i];
      const y = i === undefined ? undefined : positions.y[i];
      if (x === undefined || y === undefined) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + NODE_W); y1 = Math.max(y1, y + NODE_H);
    }
    camera.fit({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  };
  const label = `Dependency atlas, ${graph.nodes.length.toLocaleString()} repositories, ${graph.edges.length.toLocaleString()} connections`;

  return (
    <Region technique="viewport-transform" title="One camera, one conversion" note="Drag the sea to pan (3px slop, capture at the threshold); wheel zooms to the cursor; buttons zoom to the centre through the same zoomAt. Mid-gesture the <g> is driven imperatively; the state commits per frame or on release.">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={() => camera.zoomBy(1.25)} aria-label="Zoom in">+</button>
        <button type="button" className={BTN} onClick={() => camera.zoomBy(0.8)} aria-label="Zoom out">−</button>
        <button type="button" className={BTN} onClick={() => camera.fit(worldBounds(graph))}>fit all</button>
        <button type="button" className={BTN} onClick={fitSelection} disabled={selected.size === 0}>fit selection</button>
        <span className="type-caption text-slate-500" data-cam-z={cam.z.toFixed(3)} data-tier={list.tier}>
          z {cam.z.toFixed(2)} · pan ({Math.round(cam.x)}, {Math.round(cam.y)}) · tier {list.tier}
        </span>
      </div>
      <svg
        ref={svgRef}
        className="focus-ring h-[26rem] w-full touch-none rounded-lg border border-divider bg-surface-strong/40 select-none"
        tabIndex={0}
        role="application"
        aria-label={label}
        aria-activedescendant={cursor ? `cg-node-${cursor}` : undefined}
        data-canvas
        onKeyDown={p.onKeyDown}
        onClick={p.onBackgroundClick}
        {...handlers}
      >
        <g
          ref={worldRef}
          transform={camTransform(cam)}
          data-world
          style={{ ["--label-scale" as string]: labelScale(cam.z).toFixed(3), ["--label-opacity" as string]: lod(cam.z, DETAIL_Z, DETAIL_Z + 0.2).toFixed(2) }}
        >
          <EdgeLayer edges={list.edges} bundles={list.bundles} full={full} zoom={cam.z} hitWidth={p.hitWidth} selectedEdge={p.selectedEdge} onSelectEdge={p.onSelectEdge} />
          {list.columns.map((c) => (
            <g key={c.layer} data-column={c.layer}>
              <rect x={c.x} y={c.y} width={NODE_W} height={c.h} rx={12 / cam.z} style={{ fill: "var(--color-surface)" }} stroke="var(--color-divider)" strokeWidth={1 / cam.z} />
              <text x={c.x + NODE_W / 2} y={c.y + c.h / 2} textAnchor="middle" className="fill-slate-300 font-mono" fontSize={14 / cam.z}>
                {c.count}
              </text>
            </g>
          ))}
          {shown.map((i) => {
            const n = graph.nodes[i];
            const x = positions.x[i];
            const y = positions.y[i];
            if (!n || x === undefined || y === undefined) return null;
            const target = connect?.target === n.id ? (connect.ok ? "ok" : "bad") : null;
            return <NodeView key={n.id} id={n.id} name={n.name} kind={n.kind} score={n.score} x={x} y={y} selected={selected.has(n.id)} cursor={cursor === n.id} target={target} detail={full} node={p.node} port={p.port} onHover={p.onHover} />;
          })}
          <path ref={provisionalRef} d="" fill="none" stroke="var(--color-accent-soft)" strokeWidth={2 / cam.z} strokeDasharray={`${6 / cam.z} ${4 / cam.z}`} pointerEvents="none" data-provisional-edge />
        </g>
      </svg>
      <div className="mt-2 grid gap-1 sm:grid-cols-3">
        <Readout label="gesture" value={<span data-gesture-phase={phase}>{phase}</span>} />
        <Readout label="commits" value={<CommitCount stats={stats} />} />
        <Readout label="live ≡ committed" value={<span data-loan="repaid">at every commit</span>} />
      </div>
    </Region>
  );
}

/** The camera's counters as snapshotted at the last commit — a render of this readout is itself a commit's consequence, never a per-frame one. */
function CommitCount({ stats: s }: { stats: CameraStats }) {
  return <span data-commits={s.commits}>{`${s.commits} (wheel ${s.wheelEvents} ev · ${s.gestureFrames} frames · ${s.interimCommits} interim)`}</span>;
}
