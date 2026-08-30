"use client";

// ONE entry of the release notes — a run. Dateline, then the title as a CLAIM ("payments-api climbed
// ▲+6, docs-site slipped ▼-3"), then each repo as a sub-label with its deliverable lines. The lines
// carry no dimension tags, no evidence, no counts: the headline is the whole line, the way a changelog
// bullet is. A regression is the same line in orange — the repo's own delta beside its name already
// says which way it went. Five lines, then a native disclosure for the rest — no state, no hook.

import { Kicker, deltaHex, fmtDelta } from "@/components/ui";
import { timeAgo } from "@/lib/ui";
import { laneCaption } from "../cockpit/laneStages";
import type { OutcomeCell, OutcomeColumn } from "./outcomeMatrix";
import { DELTA_TOKEN, entryTitle, repoName } from "./outcomeEntries";
import { verdictWord } from "./outcomeText";

const LINES = 5;

/** The sentence with each delta token typeset in its own colour. */
function Claim({ text }: { text: string }) {
  return (
    <>
      {text.split(DELTA_TOKEN).map((part, i) =>
        DELTA_TOKEN.test(part) ? (
          <span key={i} className="font-mono tabular-nums" style={{ color: deltaHex(Number(part.slice(1))) }}>
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function RepoLines({ cell }: { cell: OutcomeCell }) {
  const inFlight = cell.phase === "queued" || cell.phase === "dispatching" || cell.phase === "rescanning";
  const rows = cell.deliverables;
  const head = rows.slice(0, LINES);
  const rest = rows.slice(LINES);
  const line = (d: OutcomeCell["deliverables"][number]) => (
    <li key={`${d.dimId ?? ""}|${d.headline}`} className={`type-body-sm ${d.kind === "regressed" ? "text-warn" : "text-slate-300"}`} title={d.evidence ?? undefined}>
      {d.headline}
    </li>
  );
  return (
    <li className="space-y-1.5">
      <p className="flex items-baseline gap-3">
        <span className="type-body-sm font-medium text-slate-100">{repoName(cell.repo)}</span>
        {inFlight ? (
          <span className="type-caption inline-flex items-center gap-1.5 text-accent">
            <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />
            {/* the stage word only — the sub-stage is the operator's, not the director's */}
            {laneCaption(cell).split(" · ")[0]}
          </span>
        ) : cell.error ? (
          <span className="type-caption text-danger">error: {cell.error}</span>
        ) : cell.verdict.kind === "attributable" ? (
          <span className="type-mono-sm tabular-nums" style={{ color: deltaHex(cell.verdict.delta) }}>
            {fmtDelta(cell.verdict.delta)}
          </span>
        ) : (
          <span className="type-caption text-slate-600">{verdictWord(cell.verdict)}</span>
        )}
      </p>
      {!inFlight && rows.length === 0 && !cell.error && <p className="type-note text-slate-600">nothing delivered</p>}
      {head.length > 0 && <ul className="space-y-1">{head.map(line)}</ul>}
      {rest.length > 0 && (
        <details className="group">
          <summary className="focus-ring type-micro cursor-pointer list-none text-slate-500 hover:text-slate-300 group-open:hidden">+{rest.length} more</summary>
          <ul className="space-y-1">{rest.map(line)}</ul>
        </details>
      )}
    </li>
  );
}

export function ReleaseNotesEntry({
  col, index, cells, latest, selected, open, onToggle,
}: { col: OutcomeColumn; index: number; cells: OutcomeCell[]; latest: boolean; selected: boolean; open: boolean; onToggle: () => void }) {
  return (
    <li className={`${open ? "py-7" : "py-4"} ${latest ? "animate-fade-up" : ""}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-pressed={selected}
        title={open ? "Collapse this run" : "Open this run"}
        className="focus-ring block w-full text-left"
      >
        <Kicker tone="muted" as="span" className={latest ? "text-slate-300" : ""}>
          Run {index} · {timeAgo(col.startedAt)}
        </Kicker>
        <span className={`${open ? "type-display" : "type-title"} mt-1.5 block max-w-3xl font-semibold tracking-tight text-slate-100`}>
          <Claim text={entryTitle(col, cells)} />
        </span>
      </button>
      {open && (
        <ol className="mt-5 max-w-3xl space-y-5 pl-0 sm:pl-6">
          {cells.map((cell) => (
            <RepoLines key={cell.repo} cell={cell} />
          ))}
        </ol>
      )}
    </li>
  );
}
