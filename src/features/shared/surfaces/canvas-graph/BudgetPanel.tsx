"use client";

// render-budget: the instrument that reads the ladder. Rung 1 — a pan re-renders zero nodes (watch
// the node-render counter hold still while the camera moves). Rung 2 — the culled set against the
// whole world, empty before the viewport is measured, mounted in waves under a frame budget. Rung 3 —
// nodes memoized on their own record, handlers stable. Rung 4 — the detail tier, the counter-scaled
// label and the opacity ramp, all functions of the committed zoom.

import { DETAIL_Z, BUNDLE_Z, labelScale, lod } from "./geometry";
import { renderCounter } from "./NodeView";
import type { RenderList } from "./renderList";
import { Readout, Region } from "./sceneParts";
import { WAVE_FRAME_BUDGET_MS } from "./useWavedMount";

export function BudgetPanel({ list, mounted, waves, waveSize, zoom, measured }: { list: RenderList; mounted: number; waves: number; waveSize: number; zoom: number; measured: boolean }) {
  return (
    <Region technique="render-budget" title="Frame cost stays flat" note="Pan: zero node renders. Zoom: one commit per frame. Only the culled set and the tier are re-derived — from named inputs.">
      <div className="space-y-1">
        <Readout label="nodes · world / in view / mounted" value={<span data-nodes-in-view={list.ranked.length} data-nodes-mounted={mounted}>{`${list.totals.nodes.toLocaleString()} / ${list.ranked.length.toLocaleString()} / ${mounted.toLocaleString()}`}</span>} />
        <Readout label="edges · world / considered / drawn" value={<span data-edges-drawn={list.edges.length + list.bundles.length}>{`${list.totals.edges.toLocaleString()} / ${list.totals.edgesConsidered.toLocaleString()} / ${(list.edges.length + list.bundles.length).toLocaleString()}`}</span>} />
        <Readout label="node renders committed" value={<span data-node-renders={renderCounter.nodes}>{renderCounter.nodes.toLocaleString()}</span>} />
        <Readout label="waves · size" value={`${waves} · ${waveSize} (budget ${WAVE_FRAME_BUDGET_MS}ms)`} />
        <Readout label="culled set before measure" value={<span data-measured={measured}>{measured ? "measured" : "empty, not everything"}</span>} />
        <Readout label="tier" value={<span data-tier={list.tier}>{`${list.tier} (bundle < ${BUNDLE_Z}, rect < ${DETAIL_Z})`}</span>} />
        <Readout label="label scale · opacity" value={`${labelScale(zoom).toFixed(2)}× · ${lod(zoom, DETAIL_Z, DETAIL_Z + 0.2).toFixed(2)}`} />
      </div>
      <p className="mt-3 type-caption text-slate-500">
        Render list = f(graph, positions, camera, viewport, edge settings, focus). Nodes never see the camera: the world <span className="text-slate-300">&lt;g&gt;</span> maps them, and the label scale is a custom property they inherit without a render.
      </p>
    </Region>
  );
}
