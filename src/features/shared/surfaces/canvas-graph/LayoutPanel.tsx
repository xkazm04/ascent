"use client";

// graph-layout: positions are user data with provenance. The generated (layered, deterministic)
// layout may re-flow on an explicit re-layout; user-authored positions are anchors it may not move;
// reset is the confirmed, one-transaction doorway back to all-generated; a new node lands beside its
// neighbour through the placement policy, never at the origin. The persisted document is versioned
// and keyed by node identity, written per completed gesture.

import { useState } from "react";
import type { NodeKind } from "./fixtures";
import { countUser, LAYOUT_DOC_VERSION, type GraphState } from "./graphStore";
import { BTN, Readout, Region } from "./sceneParts";

export function LayoutPanel({ state, total, onRelayout, onReset, onAddNode }: { state: GraphState; total: number; onRelayout: () => void; onReset: () => void; onAddNode: (kind: NodeKind) => void }) {
  const [confirm, setConfirm] = useState(false);
  const user = countUser(state);
  const doc = { v: LAYOUT_DOC_VERSION, run: state.layoutRun, positions: Object.fromEntries([...state.placed].filter(([, p]) => p.provenance === "user").slice(0, 2).map(([id, p]) => [id, [Math.round(p.x), Math.round(p.y)]])) };
  return (
    <Region technique="graph-layout" title="Layout is data with a lifecycle" note="Layered, deterministic: same graph in, same layout out. Drag a node and its position flips to user-authored — re-layout arranges around it.">
      <div className="space-y-1">
        <Readout label="user-authored / generated" value={<span data-user-placed={user}>{`${user} / ${(total - user).toLocaleString()}`}</span>} />
        <Readout label="layout run" value={<span data-layout-run={state.layoutRun}>{state.layoutRun}</span>} />
        <Readout label="placed by policy" value={state.extraNodes.length} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={onRelayout}>
          re-layout (generated only)
        </button>
        {confirm ? (
          <>
            <button type="button" className={`${BTN} border-danger text-danger`} onClick={() => { onReset(); setConfirm(false); }} data-reset-confirm>
              confirm: drop {user} placements
            </button>
            <button type="button" className={BTN} onClick={() => setConfirm(false)}>keep</button>
          </>
        ) : (
          <button type="button" className={BTN} onClick={() => setConfirm(true)} disabled={user === 0}>
            reset layout…
          </button>
        )}
        <button type="button" className={BTN} onClick={() => onAddNode("service")}>
          add node beside focus
        </button>
      </div>
      <pre className="mt-3 overflow-x-auto rounded-md border border-divider p-2 type-caption text-slate-400" data-layout-doc>
        {`layout.json v${doc.v} · ${user} entr${user === 1 ? "y" : "ies"} keyed by node id\n${JSON.stringify(doc)}${user > 2 ? " …" : ""}`}
      </pre>
      <p className="mt-2 type-caption text-slate-500">Written per completed gesture, not per pointer event; reconciled against the live graph on load; a version mismatch degrades to a visible re-layout, never a silent mis-scale.</p>
    </Region>
  );
}
