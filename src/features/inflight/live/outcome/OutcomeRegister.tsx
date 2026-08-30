"use client";

// VARIANT A — "Register". The outcome as a bound LEDGER: a hairline grid on the TILE_LEDGER bed, a
// sticky repo column down the left, one narrow ledger column per run across the top. Each cell is an
// entry — the titles the run delivered to that repo, its verdict, a mono footnote. The latest column
// is the emphasised one; clicking any column header widens it in place (a wider column shows the
// entries in full, plus the dimension deltas). Differs from the baseline by being a MATRIX the eye
// scans across runs rather than a paragraph stack inside one run.

import { Kicker, deltaHex, fmtDelta } from "@/components/ui";
import { TILE_LEDGER } from "@/components/org/shared/ui";
import { timeAgo } from "@/lib/ui";
import { CellDetail, CellFootnote, CellLive, CellTitles, CellVerdict, cellInFlight } from "./OutcomeCell";
import type { OutcomeColumn, OutcomeMatrix } from "./outcomeMatrix";
import { useOutcomeColumns } from "./useOutcomeColumns";

export interface OutcomeVariantProps {
  matrix: OutcomeMatrix;
  selectedId: string | null;
  onOpen: (id: string) => void;
}

const COMPACT = "11rem";
const EXPANDED = "20rem";

function ColumnHead({ col, latest, selected, expanded, onToggle }: { col: OutcomeColumn; latest: boolean; selected: boolean; expanded: boolean; onToggle: () => void }) {
  const phaseTone = col.phase === "error" ? "text-danger" : col.live ? "text-accent" : "text-slate-500";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-pressed={selected}
      title={expanded ? "Narrow this run" : "Widen this run"}
      className={`focus-ring block h-full w-full px-3 py-2 text-left ${selected ? "bg-accent/10" : latest ? "bg-accent/5" : ""}`}
    >
      {/* Mirrors the cell below it: words left, the number right — one alignment down the column. */}
      <span className="flex items-baseline justify-between gap-2">
        <span className="type-caption inline-flex items-center gap-1.5 text-slate-500">
          {col.live && <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />}
          {timeAgo(col.startedAt)}
        </span>
        <span className={`${latest ? "type-figure" : "type-mono-sm tabular-nums"} text-right`} style={{ color: deltaHex(col.lift ?? 0) }}>
          {col.lift == null ? "—" : fmtDelta(col.lift)}
        </span>
      </span>
      <span className="type-micro block font-mono text-slate-500">
        <span className={`uppercase tracking-[0.14em] ${phaseTone}`}>{col.phase}</span>
        {col.agentConfig && <span className="ml-1.5 text-slate-600">{col.agentConfig}</span>}
      </span>
    </button>
  );
}

export function OutcomeRegister({ matrix, selectedId, onOpen }: OutcomeVariantProps) {
  const { isExpanded, toggle, latestRef } = useOutcomeColumns(matrix.latestId);
  const width = (id: string) => (isExpanded(id) ? EXPANDED : COMPACT);
  return (
    <div className={`${TILE_LEDGER} overflow-x-auto`}>
      <table className="w-max min-w-full border-separate border-spacing-px">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-48 bg-ink px-3 py-2 text-left align-bottom">
              <Kicker tone="muted" as="span">Repo</Kicker>
            </th>
            {matrix.columns.map((col) => (
              <th
                key={col.id}
                scope="col"
                ref={col.id === matrix.latestId ? (el) => void (latestRef.current = el) : undefined}
                className="bg-ink p-0 align-bottom motion-safe:transition-[width] motion-safe:duration-300"
                style={{ width: width(col.id), minWidth: width(col.id) }}
              >
                <ColumnHead
                  col={col}
                  latest={col.id === matrix.latestId}
                  selected={col.id === selectedId}
                  expanded={isExpanded(col.id)}
                  onToggle={() => {
                    toggle(col.id);
                    onOpen(col.id);
                  }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.groups.map((g) => (
            <tr key={g.repo} className="align-top">
              <th scope="row" className="sticky left-0 z-10 bg-ink px-3 py-2 text-left font-normal">
                <span className="type-mono-sm block truncate text-slate-200" title={g.repo}>
                  {g.repo.split("/")[1] ?? g.repo}
                </span>
                <span className="type-caption block text-slate-500">
                  {g.lift == null ? "no attributable lift" : <span style={{ color: deltaHex(g.lift) }}>{fmtDelta(g.lift)} cumulative</span>}
                </span>
              </th>
              {matrix.columns.map((col) => {
                const cell = g.cells[col.id];
                const expanded = isExpanded(col.id);
                return (
                  <td key={col.id} className={`bg-ink px-3 py-2 ${col.id === matrix.latestId ? "bg-accent/5" : ""}`}>
                    {!cell ? (
                      <span className="type-caption text-slate-600">·</span>
                    ) : cellInFlight(cell) ? (
                      <CellLive cell={cell} />
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <CellTitles cell={cell} expanded={expanded} />
                          </div>
                          <CellVerdict cell={cell} />
                        </div>
                        {expanded && <CellDetail cell={cell} />}
                        <CellFootnote cell={cell} />
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
