// ONE cell of the matrix — the hook-free parts: the verdict (a delta, or the refusal word in its
// place), the live caption, the per-dimension deltas (coloured only when claimable) and the mono
// footnote. The deliverable rows live in OutcomeCellRows.tsx, which holds the widen state.

import { deltaHex, fmtDelta } from "@/components/ui";
import { laneCaption } from "../cockpit/laneStages";
import type { OutcomeCell as Cell } from "./outcomeMatrix";
import { cellFootnote, verdictWord } from "./outcomeText";

export function CellVerdict({ cell, size = "sm" }: { cell: Cell; size?: "sm" | "figure" }) {
  const v = cell.verdict;
  const cls = size === "figure" ? "type-figure" : "type-mono-sm tabular-nums";
  if (v.kind === "attributable") {
    return (
      <span className={`${cls} shrink-0 text-right`} style={{ color: deltaHex(v.delta) }}>
        {fmtDelta(v.delta)}
      </span>
    );
  }
  return <span className="type-caption shrink-0 text-right text-slate-600">{verdictWord(v)}</span>;
}

export function CellLive({ cell }: { cell: Cell }) {
  return (
    <span className="type-caption inline-flex items-center gap-1.5 text-accent">
      <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />
      {laneCaption(cell)}
    </span>
  );
}

/** The per-dimension deltas — evidence for the widened cell only. */
export function CellDims({ cell }: { cell: Cell }) {
  if (cell.dims.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
      {cell.dims.map((d) => (
        <li key={d.id} className="type-caption tabular-nums">
          <span className="text-slate-500">{d.short}</span>{" "}
          <span
            style={{ color: d.claimable ? deltaHex(d.delta) : undefined }}
            className={d.claimable ? undefined : "text-slate-600"}
            title={d.claimable ? undefined : "Not attributable to this run"}
          >
            {fmtDelta(d.delta)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CellFootnote({ cell }: { cell: Cell }) {
  return (
    <p className="type-micro mt-1.5 font-mono tabular-nums text-slate-500">
      {cellFootnote(cell.commits, cell.gaps)}
      {cell.error && <span className="ml-2 text-danger">{cell.error}</span>}
    </p>
  );
}

/** A cell is "in flight" while its lane has not produced an after-scan yet. */
export const cellInFlight = (cell: Cell): boolean =>
  cell.phase === "queued" || cell.phase === "dispatching" || cell.phase === "rescanning";
