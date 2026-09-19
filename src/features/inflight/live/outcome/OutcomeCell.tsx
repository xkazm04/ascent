// A (run, repo) cell's hook-free parts — what the sheet's PROJECT HEADER row prints: the verdict (a
// delta, or the refusal word in its place), the live caption, and the mono footnote. The gap rows
// beneath it are OutcomeSheetCell.tsx.

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
