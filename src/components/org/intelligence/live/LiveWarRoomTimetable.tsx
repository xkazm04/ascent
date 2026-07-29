"use client";

// Fleet-evolution TIMETABLE — the main-wall centerpiece that replaced the leaderboard/posture/movers/
// kickoff panels: repos as rows, scan days as columns, overall score (+ run-over-run delta) per cell.
// A per-repo checkbox picks which repos the wall will scan (default all UNCHECKED — scanning is
// explicit now that the auto-relaunch is gone). This file is the shell (selection + scan CTA); it
// renders the Ledger view and exports the shared atoms + the `TimetableView` contract.

import Link from "next/link";
import { reportPermalink } from "@/lib/ui";
import { Kicker, deltaHex, fmtDelta } from "@/components/ui";
import type { FleetTimetable, TimetableRow } from "@/components/org/intelligence/live/fleetTimetable";
import { TimetableLedger } from "@/components/org/intelligence/live/LiveWarRoomTimetableLedger";

/** What each timetable variant renders over. */
export interface TimetableView {
  data: FleetTimetable;
  slug: string;
  selected: Set<string>;
  onToggle: (fullName: string) => void;
  /** Kiosk/shared display: no scan selection, so rows render as a plain report link (no checkbox). */
  readOnly?: boolean;
}

/** Checkbox + report-linked repo name — the shared first cell of every row. */
export function RepoCheck({ row, selected, onToggle, readOnly }: { row: TimetableRow; selected: boolean; onToggle: () => void; readOnly?: boolean }) {
  const nameLink = (
    <Link href={reportPermalink(row.fullName)} className="truncate font-mono text-sm text-slate-200 hover:text-accent" title={row.fullName}>
      {row.name}
    </Link>
  );
  if (readOnly) return <span className="flex min-w-0 items-center">{nameLink}</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <input type="checkbox" checked={selected} onChange={onToggle} className="accent-accent shrink-0" aria-label={`Select ${row.name} to scan`} />
      {nameLink}
    </span>
  );
}

/** Signed evolution delta over the shown window (lime up · orange down), or a muted dash. */
export function DeltaChip({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="font-mono text-xs text-slate-600">—</span>;
  return (
    <span className="font-mono text-sm" style={{ color: deltaHex(delta) }}>
      {fmtDelta(delta)}
    </span>
  );
}

export function FleetTimetablePanel({
  data,
  slug,
  selected,
  onSetSelected,
  onScanSelected,
  scanning,
  readOnly = false,
}: {
  data: FleetTimetable;
  slug: string;
  selected: Set<string>;
  onSetSelected: (next: Set<string>) => void;
  onScanSelected: (fullNames: string[]) => void;
  scanning: boolean;
  /** Kiosk/shared display: render the grid but no scan-selection controls. */
  readOnly?: boolean;
}) {
  const onToggle = (fullName: string) => {
    const next = new Set(selected);
    if (next.has(fullName)) next.delete(fullName);
    else next.add(fullName);
    onSetSelected(next);
  };
  const allOn = data.rows.length > 0 && data.rows.every((r) => selected.has(r.fullName));
  const selectAll = () => onSetSelected(allOn ? new Set() : new Set(data.rows.map((r) => r.fullName)));

  const view: TimetableView = { data, slug, selected, onToggle, readOnly };
  const n = selected.size;

  if (data.rows.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-divider bg-surface/40 p-6">
        <Kicker>Fleet evolution</Kicker>
        <p className="mt-2 text-base text-slate-400">No scan history yet — scan some repositories and their score-over-time lands here.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-divider bg-surface/40">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-divider px-4 py-2.5">
        <h3 className="font-mono text-sm uppercase tracking-widest text-accent">Fleet evolution</h3>
        <span className="hidden font-mono text-sm text-slate-500 sm:inline">
          {readOnly ? "overall score per scan" : "overall score per scan · pick repos to run"}
        </span>
        <span className="flex-1" />
        {!readOnly && (
          <>
            <button type="button" onClick={selectAll} className="focus-ring rounded font-mono text-sm text-slate-500 transition hover:text-slate-300">
              {allOn ? "clear" : "select all"}
            </button>
            <button
              type="button"
              onClick={() => onScanSelected([...selected])}
              disabled={n === 0 || scanning}
              title={n === 0 ? "Check repos to scan" : `Scan the ${n} selected ${n === 1 ? "repo" : "repos"}`}
              className="focus-ring rounded-lg bg-accent px-3 py-1 font-mono text-sm font-semibold text-on-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
            >
              {scanning ? "Scanning…" : `▶ Scan selected (${n})`}
            </button>
          </>
        )}
      </header>
      <TimetableLedger {...view} />
    </div>
  );
}
