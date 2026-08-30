// ONE cell of the matrix — what a run delivered to a repo. Shared by both variants: the Register and
// the Storyboard differ in chrome and rhythm, not in which facts a cell may print. No hooks, so a
// server tree could render it; the variants that hold state carry "use client" themselves.
//
// Compact: up to three one-line clipped titles + the verdict + a mono footnote. Expanded: full titles,
// the per-dimension deltas (coloured only when claimable) and up to two movement lines.

import { deltaHex, fmtDelta } from "@/components/ui";
import { laneCaption } from "../cockpit/laneStages";
import type { OutcomeCell as Cell } from "./outcomeMatrix";
import { cellFootnote, shortTitle, verdictWord } from "./outcomeText";

const COMPACT_TITLES = 3;

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

export function CellTitles({ cell, expanded }: { cell: Cell; expanded: boolean }) {
  const shown = expanded ? cell.titles : cell.titles.slice(0, COMPACT_TITLES);
  const more = cell.titles.length - shown.length;
  if (!cell.installed && shown.length === 0) {
    return <p className="type-caption text-slate-600">no deliverables</p>;
  }
  return (
    <ul className="space-y-0.5">
      {cell.installed && (
        <li className="type-body-sm text-slate-200">
          <span className="mr-1.5 rounded-sm border border-divider px-1 type-micro uppercase tracking-wide text-slate-400">{cell.kind}</span>
          {cell.installed}
        </li>
      )}
      {shown.map((t) => (
        <li key={t} className={`type-body-sm text-slate-200 ${expanded ? "" : "truncate"}`} title={expanded ? undefined : t}>
          {expanded ? t : shortTitle(t)}
        </li>
      ))}
      {more > 0 && <li className="type-micro text-slate-500">+{more} more</li>}
    </ul>
  );
}

export function CellDetail({ cell }: { cell: Cell }) {
  return (
    <>
      {cell.dims.length > 0 && (
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
      )}
      {cell.movements.map((line) => (
        <p key={line} className="type-note mt-1 text-slate-400">
          {line}
        </p>
      ))}
    </>
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
