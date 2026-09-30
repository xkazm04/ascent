"use client";

// The run strip: level 1 of the Prism outcome surface. One hairline row per run, newest first, each a button that
// opens the run. What a row claims is exactly what the sheet's column header claims and nothing more: the lift is
// printed only when the pair was attributable (else an em dash and the word "not measured", never a 0), a live run
// is marked, and a failed run reads as failed. Ages are measured from the page's own instant (`nowMs`) so the
// server render and the hydrated one print the same words.
import { deltaHex, fmtDelta } from "@/components/ui";
import { timeAgo } from "@/lib/ui";
import type { OutcomeColumn } from "./outcomeMatrix";
import { HairlineList } from "@/components/kit";

const MAX_ROWS = 8;
const ROW = "grid grid-cols-[5.5rem_6rem_minmax(0,1fr)_auto] items-baseline gap-x-4";

export function OutcomeRunStrip({ columns, selectedId, nowMs, onOpen }: { columns: OutcomeColumn[]; selectedId: string | null; nowMs?: number; onOpen: (id: string) => void }) {
  // Columns are chronological (Run 1 first); the strip leads with the newest and keeps the run's own number.
  const rows = columns.map((c, i) => ({ c, n: i + 1 })).reverse();
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <div data-role="run-strip">
      <div aria-hidden className={`${ROW} pb-2 pt-3 type-caption text-slate-500`}>
        <span>Run</span>
        <span>Started</span>
        <span>What it did</span>
        <span>Lift</span>
      </div>
      <HairlineList >
        {shown.map(({ c, n }) => {
          const tone = c.phase === "error" ? "text-danger" : c.live ? "text-white" : "text-slate-400";
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                aria-pressed={c.id === selectedId}
                title="Open this run: it drifts the field and opens its column in the matrix"
                className={`focus-ring ${ROW} w-full py-3 text-left hover:bg-white/[0.03] aria-pressed:bg-white/[0.05]`}
              >
                <span className="type-body-sm font-semibold text-white">
                  Run {n}
                  {c.live && <span aria-hidden className="live-dot ml-2 inline-block h-1.5 w-1.5 rounded-full bg-white align-middle" />}
                </span>
                <span className="type-caption text-slate-400">{timeAgo(c.startedAt, nowMs)}</span>
                <span className="min-w-0 truncate type-caption text-slate-400">
                  {c.repoCount} {c.repoCount === 1 ? "repo" : "repos"} · {c.gaps} gaps · <span className={tone}>{c.phase}</span>
                  {c.engine && <span className="text-slate-500"> · {c.engine}</span>}
                </span>
                <span className="type-mono-sm tabular-nums" style={{ color: c.lift == null ? undefined : deltaHex(c.lift) }} title={c.lift == null ? "not measured" : undefined}>
                  {c.lift == null ? <span className="text-slate-500">—</span> : fmtDelta(c.lift)}
                </span>
              </button>
            </li>
          );
        })}
      </HairlineList>
      {rows.length > shown.length && <p className="mt-3 type-caption text-slate-500">{rows.length - shown.length} earlier runs are in the matrix.</p>}
    </div>
  );
}
