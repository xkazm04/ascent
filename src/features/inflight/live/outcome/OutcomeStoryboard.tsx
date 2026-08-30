"use client";

// VARIANT B — "Storyboard". The outcome as a FILM STRIP: each run is a vertical frame in a horizontal
// strip, the latest frame wide by default with a typeset lift headline and the deliverables as short
// bulleted lists per repo; older frames are thumbnails — repo + verdict only — until clicked. The
// repos are the strip's rows and stay aligned across frames (one CSS grid, not one grid per frame),
// so the eye can follow a single repo left→right through its runs. Differs from the Register by
// reading as a sequence of scenes rather than as a ledger you look things up in.

import { Kicker, deltaHex, fmtDelta } from "@/components/ui";
import { timeAgo } from "@/lib/ui";
import { CellDetail, CellFootnote, CellLive, CellTitles, CellVerdict, cellInFlight } from "./OutcomeCell";
import type { OutcomeColumn } from "./outcomeMatrix";
import type { OutcomeVariantProps } from "./OutcomeRegister";
import { useOutcomeColumns } from "./useOutcomeColumns";

const THUMB = "10rem";
const FRAME = "22rem";

function FrameHead({ col, index, latest, selected, expanded, onToggle }: { col: OutcomeColumn; index: number; latest: boolean; selected: boolean; expanded: boolean; onToggle: () => void }) {
  const phaseTone = col.phase === "error" ? "text-danger" : col.live ? "text-accent" : "text-slate-500";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-pressed={selected}
      title={expanded ? "Collapse this run" : "Open this run"}
      className={`focus-ring block h-full w-full border-b border-divider px-4 py-3 text-left ${selected ? "bg-accent/10" : ""}`}
    >
      <span className="flex items-center justify-between gap-2">
        <Kicker tone="muted" as="span" className={latest ? "text-slate-300" : ""}>
          Run {index + 1}
          {col.live && <span aria-hidden className="live-dot ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />}
        </Kicker>
        <span className="type-caption text-slate-500">{timeAgo(col.startedAt)}</span>
      </span>
      <span className={`${expanded ? "type-figure-lg" : "type-figure"} mt-1 block`} style={{ color: deltaHex(col.lift ?? 0) }}>
        {col.lift == null ? "—" : fmtDelta(col.lift)}
      </span>
      <span className="type-micro block font-mono tabular-nums text-slate-500">
        {col.repoCount} {col.repoCount === 1 ? "repo" : "repos"} · {col.gaps} gaps ·{" "}
        <span className={`uppercase tracking-[0.14em] ${phaseTone}`}>{col.phase}</span>
        {expanded && col.agentConfig && <span className="ml-1.5 text-slate-600">{col.agentConfig}</span>}
      </span>
    </button>
  );
}

export function OutcomeStoryboard({ matrix, selectedId, onOpen }: OutcomeVariantProps) {
  const { isExpanded, toggle, latestRef } = useOutcomeColumns(matrix.latestId);
  const template = matrix.columns.map((c) => (isExpanded(c.id) ? FRAME : THUMB)).join(" ");
  return (
    <div className="overflow-x-auto rounded-2xl border border-divider bg-divider">
      <div
        className="grid w-max min-w-full gap-px motion-safe:transition-[grid-template-columns] motion-safe:duration-300"
        style={{ gridTemplateColumns: template }}
      >
        {matrix.columns.map((col, i) => (
          <div
            key={col.id}
            ref={col.id === matrix.latestId ? (el) => void (latestRef.current = el) : undefined}
            className="bg-ink"
            style={{ gridColumn: i + 1, gridRow: 1 }}
          >
            <FrameHead
              col={col}
              index={i}
              latest={col.id === matrix.latestId}
              selected={col.id === selectedId}
              expanded={isExpanded(col.id)}
              onToggle={() => {
                toggle(col.id);
                onOpen(col.id);
              }}
            />
          </div>
        ))}
        {matrix.groups.map((g, r) =>
          matrix.columns.map((col, i) => {
            const cell = g.cells[col.id];
            const expanded = isExpanded(col.id);
            return (
              <div key={`${g.repo}:${col.id}`} className="min-h-12 bg-ink px-4 py-2.5" style={{ gridColumn: i + 1, gridRow: r + 2 }}>
                {!cell ? null : (
                  <>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="type-mono-sm min-w-0 truncate text-slate-300" title={g.repo}>
                        {g.repo.split("/")[1] ?? g.repo}
                      </span>
                      {cellInFlight(cell) ? <CellLive cell={cell} /> : <CellVerdict cell={cell} />}
                    </div>
                    {expanded && !cellInFlight(cell) && (
                      <div className="mt-1 border-l border-divider pl-3">
                        <CellTitles cell={cell} expanded />
                        <CellDetail cell={cell} />
                        <CellFootnote cell={cell} />
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
