"use client";

// Edges (edge-management): every path is drawn from the anchors the shared geometry function returned
// — the same function the nodes and the hit-test read — so a link cannot float off its node. Focus-
// context: with a node hovered or selected, its edges keep full ink and the rest recede. Each edge is
// hit-tested against a FAT invisible stroke (`hitWidth` screen px, counter-scaled so it feels the
// same at every zoom) laid over the same path; the selected edge thickens and lifts. Arrowheads sit
// at the anchor, outside the border, oriented along the final segment by the marker itself.

import { memo } from "react";
import type { EdgeKind } from "./fixtures";
import type { Bundle, DrawnEdge } from "./renderList";

const KIND_STROKE: Record<EdgeKind, string> = { import: "var(--color-accent)", deploy: "var(--color-success)", reference: "var(--color-warn)" };

export const EdgeLayer = memo(function EdgeLayer({
  edges,
  bundles,
  full,
  zoom,
  hitWidth,
  selectedEdge,
  onSelectEdge,
}: {
  edges: DrawnEdge[];
  bundles: Bundle[];
  /** Full-detail tier: arrowheads and hit strokes; the rect tier draws thinner, plainer paths. */
  full: boolean;
  zoom: number;
  hitWidth: number;
  selectedEdge: string | null;
  onSelectEdge: (id: string | null) => void;
}) {
  return (
    <g data-edge-layer data-drawn={edges.length + bundles.length}>
      <defs>
        <marker id="cg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0.5 L8 4 L0 7.5 z" style={{ fill: "var(--color-accent-soft)" }} />
        </marker>
      </defs>
      {bundles.map((b) => (
        <g key={b.id} data-bundle={b.id}>
          <line x1={b.a.x} y1={b.a.y} x2={b.b.x} y2={b.b.y} stroke="var(--color-accent)" strokeOpacity={0.35} strokeWidth={Math.min(60, 4 + b.count / 4) / zoom} strokeLinecap="round" />
        </g>
      ))}
      {edges.map((e) => {
        const sel = e.id === selectedEdge;
        const width = (sel ? 3 : full ? 1 + e.weight * 0.3 : 1) / Math.max(zoom, 0.25);
        return (
          <g key={e.id} data-edge-id={e.id} data-lit={e.lit} data-selected={sel || undefined}>
            <path d={e.d} fill="none" stroke={sel ? "var(--color-accent-soft)" : KIND_STROKE[e.kind]} strokeWidth={width} strokeOpacity={e.lit ? (sel ? 1 : 0.7) : 0.08} markerEnd={full && e.lit ? "url(#cg-arrow)" : undefined} pointerEvents="none" />
            {full ? (
              <path
                d={e.d}
                fill="none"
                stroke="transparent"
                strokeWidth={hitWidth / zoom}
                className="cursor-pointer"
                data-edge-hit={e.id}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelectEdge(sel ? null : e.id);
                }}
              >
                <title>{`${e.from} → ${e.to} · ${e.kind} · weight ${e.weight}`}</title>
              </path>
            ) : null}
          </g>
        );
      })}
    </g>
  );
});
