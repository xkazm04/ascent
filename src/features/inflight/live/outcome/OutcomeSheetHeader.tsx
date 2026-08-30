"use client";

// THE SHEET'S COLUMN HEADER — one column per run, chronological, the latest emphasised and a live run
// marked. Every header is a button, because every past run is REPLAYABLE: clicking one opens that run
// and drifts the field, exactly as if you had watched it happen.
//
// The frozen label column's header is the sheet's origin cell; it carries the label column's own drag
// handle, because "the project and gap names are too narrow" is the first complaint a sheet earns.

import { Kicker, deltaHex, fmtDelta } from "@/components/ui";
import { timeAgo } from "@/lib/ui";
import { ColumnResizer } from "./ColumnResizer";
import type { OutcomeColumn } from "./outcomeMatrix";
import { LABEL_COLUMN } from "./useColumnWidths";

export interface OutcomeSheetHeaderProps {
  columns: OutcomeColumn[];
  latestId: string | null;
  selectedId: string | null;
  widthOf: (id: string) => number;
  setWidth: (id: string, px: number) => void;
  onOpen: (id: string) => void;
  latestRef: (el: HTMLTableCellElement | null) => void;
}

export function OutcomeSheetHeader(p: OutcomeSheetHeaderProps) {
  return (
    <thead>
      <tr>
        <th scope="col" className="sticky left-0 top-0 z-30 border-b border-r border-divider bg-ink px-3 py-3 text-left align-bottom">
          <Kicker tone="muted" as="span">
            Project · gap
          </Kicker>
          <ColumnResizer label="project and gap" width={p.widthOf(LABEL_COLUMN)} onResize={(px) => p.setWidth(LABEL_COLUMN, px)} />
        </th>
        {p.columns.map((col, i) => {
          const latest = col.id === p.latestId;
          const phaseTone = col.phase === "error" ? "text-danger" : col.live ? "text-accent" : "text-slate-500";
          return (
            <th
              key={col.id}
              scope="col"
              ref={latest ? p.latestRef : undefined}
              className={`relative border-b border-l border-divider p-0 text-left align-bottom ${latest ? "bg-surface/40" : "bg-ink"}`}
            >
              <button
                type="button"
                onClick={() => p.onOpen(col.id)}
                aria-pressed={col.id === p.selectedId}
                title="Open this run — it drifts the field"
                className={`focus-ring block w-full px-3 py-2 text-left ${col.id === p.selectedId ? "bg-accent/10" : ""}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <Kicker tone="muted" as="span" className={latest ? "text-slate-300" : ""}>
                    Run {i + 1}
                    {col.live && <span aria-hidden className="live-dot ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />}
                  </Kicker>
                  <span className="type-caption text-slate-500">{timeAgo(col.startedAt)}</span>
                </span>
                <span className="type-figure mt-0.5 block tabular-nums" style={{ color: deltaHex(col.lift ?? 0) }}>
                  {col.lift == null ? "—" : fmtDelta(col.lift)}
                </span>
                <span className="type-micro block truncate font-mono tabular-nums text-slate-500">
                  {col.repoCount} {col.repoCount === 1 ? "repo" : "repos"} · {col.gaps} gaps ·{" "}
                  <span className={`uppercase tracking-[0.14em] ${phaseTone}`}>{col.phase}</span>
                  {col.agentConfig && <span className="ml-1.5 text-slate-600">{col.agentConfig}</span>}
                </span>
              </button>
              <ColumnResizer label={`run ${i + 1}`} width={p.widthOf(col.id)} onResize={(px) => p.setWidth(col.id, px)} />
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
