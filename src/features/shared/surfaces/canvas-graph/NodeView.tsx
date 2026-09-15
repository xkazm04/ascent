"use client";

// One node, memoized on its own record + its own booleans (render-budget rung 3). It never receives
// the camera: it positions itself in WORLD units once, and the world <g> maps it to the screen — so a
// pan or a zoom re-renders zero nodes. Label counter-scaling and the detail ramp arrive as CSS custom
// properties set on the world <g> by the container, inherited here without a render. The port's hit
// target (r 8) exceeds its visual (r 3): the dot is a label, the circle is a promise.

import { memo, useEffect } from "react";
import { scoreHex } from "@/lib/ui";
import type { NodeKind } from "./fixtures";
import { NODE_H, NODE_W } from "./geometry";
import type { NodeHandlers, PortHandlers } from "./useNodeGestures";

/** How many node renders have committed — written by a post-commit effect, read by the budget panel. */
export const renderCounter = { nodes: 0 };

export type NodeViewProps = {
  id: string;
  name: string;
  kind: NodeKind;
  score: number;
  x: number;
  y: number;
  selected: boolean;
  cursor: boolean;
  /** Connect-gesture role: the candidate under the pointer (valid or not), or nothing. */
  target: "ok" | "bad" | null;
  detail: boolean;
  node: NodeHandlers;
  port: PortHandlers;
  onHover: (id: string | null) => void;
};

const KIND_LABEL: Record<NodeKind, string> = { app: "APP", service: "SVC", lib: "LIB" };

export const NodeView = memo(function NodeView({ id, name, kind, score, x, y, selected, cursor, target, detail, node, port, onHover }: NodeViewProps) {
  useEffect(() => {
    renderCounter.nodes += 1;
  });
  const stroke = target === "ok" ? "var(--color-success)" : target === "bad" ? "var(--color-danger)" : selected ? "var(--color-accent)" : "var(--color-divider)";
  return (
    <g
      id={`cg-node-${id}`}
      data-node-id={id}
      data-selected={selected || undefined}
      data-cursor={cursor || undefined}
      transform={`translate(${x} ${y})`}
      className="cursor-grab"
      role="group"
      aria-label={`${name}, ${kind}`}
      onPointerEnter={() => onHover(id)}
      onPointerLeave={() => onHover(null)}
      {...node}
    >
      {cursor ? <rect x={-4} y={-4} width={NODE_W + 8} height={NODE_H + 8} rx={10} fill="none" stroke="var(--color-accent-soft)" strokeDasharray="4 3" strokeWidth={1.5} /> : null}
      <rect width={NODE_W} height={NODE_H} rx={8} style={{ fill: selected ? "color-mix(in srgb, var(--color-accent) 12%, var(--color-surface))" : "var(--color-surface)" }} stroke={stroke} strokeWidth={target || selected ? 2 : 1} />
      {detail ? (
        <g style={{ opacity: "var(--label-opacity, 1)" }}>
          <g style={{ transform: "scale(var(--label-scale, 1))", transformOrigin: "10px 22px", transformBox: "view-box" }}>
            <text x={10} y={19} className="fill-slate-200 font-mono" fontSize={12}>
              {name}
            </text>
            <text x={10} y={35} className="fill-slate-500 font-mono" fontSize={10} letterSpacing={1.2}>
              {KIND_LABEL[kind]}
            </text>
          </g>
          <text x={NODE_W - 12} y={35} className="font-mono" fontSize={10} textAnchor="end" style={{ fill: scoreHex(score) }}>
            {score}
          </text>
        </g>
      ) : null}
      {detail ? (
        <g data-node-id={id} data-port="out" className="cursor-crosshair" {...port}>
          <circle cx={NODE_W} cy={NODE_H / 2} r={8} fill="transparent" />
          <circle cx={NODE_W} cy={NODE_H / 2} r={3} style={{ fill: "var(--color-accent)" }} />
        </g>
      ) : null}
    </g>
  );
});
