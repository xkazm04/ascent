"use client";

// direct-manipulation: what the gesture layer is doing right now, and the ledger it writes. A press
// is a click until it travels SLOP_PX in screen space; a node captures at press (it is the whole
// target), the sea captures at the threshold (its children own their clicks); the connect drag shows
// validity live and cancels on release-elsewhere; Escape ends any gesture with the model untouched.
// Every completed gesture is exactly one history entry.

import { Readout, Region, BTN } from "./sceneParts";
import { SLOP_PX, type PanPhase } from "./useCamera";
import type { ConnectState, DragPhase } from "./useNodeGestures";

const CAPTURE: Record<DragPhase | PanPhase, string> = {
  idle: "none held",
  press: "held by the pressed element",
  drag: "held by the node — outlives any overlay it crosses",
  pan: "held by the sea — taken at the threshold, not at press",
  connect: "held by the port; targets read by hit-test under the pointer",
};

export function ManipulationPanel({ drag, pan, connect, history, selectedCount, onCancel }: { drag: DragPhase; pan: PanPhase; connect: ConnectState | null; history: string[]; selectedCount: number; onCancel: () => void }) {
  const phase = drag !== "idle" ? drag : pan;
  return (
    <Region technique="direct-manipulation" title="Grab structure, change it" note={`Threshold ${SLOP_PX}px in screen space at every zoom. Drag = origin + converted delta, committed once on release; the model is untouched until then.`}>
      <div className="space-y-1">
        <Readout label="gesture" value={<span data-drag-phase={phase}>{phase}</span>} tone={phase === "idle" ? "text-slate-200" : "text-accent-soft"} />
        <Readout label="pointer capture" value={CAPTURE[phase]} />
        <Readout
          label="connect validity"
          value={<span data-connect-valid={connect ? String(connect.ok) : undefined}>{connect ? `${connect.target ?? "no target"} — ${connect.reason}` : "drag from a node's port"}</span>}
          tone={connect ? (connect.ok ? "text-success-soft" : "text-danger") : "text-slate-200"}
        />
        <Readout label="selected" value={`${selectedCount} (click replaces · shift+click toggles)`} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" className={BTN} onClick={onCancel} aria-label="Cancel the in-flight gesture">
          Esc · cancel gesture
        </button>
        <span className="type-caption text-slate-500">Escape returns the nodes and discards the provisional edge.</span>
      </div>
      <ol className="mt-3 space-y-1" aria-label="Transactions, most recent first" data-history-count={history.length}>
        {history.length === 0 ? <li className="type-caption text-slate-600">no transactions yet — every completed gesture lands here as one entry</li> : null}
        {history.map((h, i) => (
          <li key={`${i}-${h}`} className="type-caption text-slate-300">
            <span className="text-slate-600">{String(history.length - i).padStart(2, "0")}</span> {h}
          </li>
        ))}
      </ol>
    </Region>
  );
}
