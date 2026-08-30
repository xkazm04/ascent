"use client";

// The ROWS under the verdict. A repo row is one 32px line: repo · the number or the refusal word ·
// what it delivered (the first headline; the full list rides in the tooltip). A run row is quieter
// still: run · one word (climbed / slipped / no lift / live / error) · when — no figure, no sentence,
// so nothing competes with the judged run's verdict. Numbers are mono, tabular and right-aligned in a
// fixed column so the eye can scan them without reading the text.

import { deltaHex, fmtDelta } from "@/components/ui";
import { timeAgo } from "@/lib/ui";
import { laneCaption } from "../cockpit/laneStages";
import type { OutcomeCell, OutcomeColumn } from "./outcomeMatrix";
import { repoName, runWord } from "./outcomeEntries";
import { verdictWord } from "./outcomeText";

const ROW = "grid h-8 items-center gap-x-4 px-4 [grid-template-columns:minmax(7rem,12rem)_5rem_minmax(0,1fr)]";

function Verdict({ cell }: { cell: OutcomeCell }) {
  const v = cell.verdict;
  if (v.kind === "attributable") {
    return (
      <span className="type-mono-sm text-right tabular-nums" style={{ color: deltaHex(v.delta) }}>
        {fmtDelta(v.delta)}
      </span>
    );
  }
  return <span className="type-micro truncate text-right font-mono text-slate-600">{verdictWord(v)}</span>;
}

export function EarnedRepoRow({ cell }: { cell: OutcomeCell }) {
  const inFlight = cell.phase === "queued" || cell.phase === "dispatching" || cell.phase === "rescanning";
  const rows = cell.deliverables;
  const first = rows[0];
  const down = first?.kind === "regressed";
  return (
    <li className={`${ROW} border-b border-divider last:border-b-0`}>
      <span className="type-mono-sm truncate text-slate-300" title={cell.repo}>
        {repoName(cell.repo)}
      </span>
      {inFlight || cell.error ? <span /> : <Verdict cell={cell} />}
      {inFlight ? (
        <span className="type-caption inline-flex items-center gap-1.5 text-accent">
          <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />
          {laneCaption(cell).split(" · ")[0]}
        </span>
      ) : cell.error ? (
        <span className="type-caption truncate text-danger">error: {cell.error}</span>
      ) : first ? (
        <span className={`type-body-sm truncate ${down ? "text-warn" : "text-slate-200"}`} title={rows.map((d) => d.headline).join("\n")}>
          {first.headline}
        </span>
      ) : (
        <span className="type-caption text-slate-600">nothing delivered</span>
      )}
    </li>
  );
}

export function EarnedRunRow({ col, index, cells, onOpen }: { col: OutcomeColumn; index: number; cells: OutcomeCell[]; onOpen: () => void }) {
  const word = runWord(col, cells);
  const tone = word === "climbed" ? deltaHex(col.lift ?? 0) : word === "slipped" ? deltaHex(col.lift ?? 0) : undefined;
  return (
    <li className="border-b border-divider last:border-b-0">
      <button type="button" onClick={onOpen} title="Judge this run" className={`${ROW} focus-ring w-full text-left hover:bg-surface/40`}>
        <span className="type-mono-sm truncate text-slate-400">Run {index}</span>
        <span className={`type-micro text-right font-mono ${tone ? "" : word === "error" ? "text-danger" : word === "live" ? "text-accent" : "text-slate-600"}`} style={tone ? { color: tone } : undefined}>
          {word}
        </span>
        <span className="type-micro font-mono text-slate-600">{timeAgo(col.startedAt)}</span>
      </button>
    </li>
  );
}
