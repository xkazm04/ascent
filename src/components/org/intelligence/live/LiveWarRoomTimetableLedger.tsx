"use client";

// Fleet-evolution timetable view (the "Index" reading): typeset colored numerals on a hairline grid,
// each score inked by its level via scoreHex, with the per-scan run-over-run delta beside it (the
// efficiency differentiator — how much THAT scan moved the score). Sticky first column; fleet-avg
// footer; the trailing Δ column is the whole-window evolution.

import { scoreHex } from "@/lib/ui";
import { Kicker, deltaHex } from "@/components/ui";
import { columnAverages } from "@/components/org/intelligence/live/fleetTimetable";
import { DeltaChip, RepoCheck, type TimetableView } from "@/components/org/intelligence/live/LiveWarRoomTimetable";

export function TimetableLedger({ data, selected, onToggle, readOnly }: TimetableView) {
  const avgs = columnAverages(data);
  return (
    <div className="overflow-x-auto p-4">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-divider">
            <th className="sticky left-0 z-10 bg-surface px-2 py-1.5 text-left">
              <Kicker tone="muted">Repo</Kicker>
            </th>
            {data.columns.map((c) => (
              <th key={c.key} className="px-2 py-1.5 text-right font-mono text-xs uppercase tracking-widest text-slate-500">
                {c.label}
              </th>
            ))}
            <th className="px-2 py-1.5 text-right font-mono text-xs uppercase tracking-widest text-slate-500">Δ</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.fullName} className="border-b border-divider/40">
              <td className="sticky left-0 z-10 bg-surface px-2 py-1">
                <RepoCheck row={r} selected={selected.has(r.fullName)} onToggle={() => onToggle(r.fullName)} readOnly={readOnly} />
              </td>
              {r.cells.map((v, i) => {
                const d = r.cellDeltas[i];
                return (
                  <td key={i} className="whitespace-nowrap px-2 py-1 text-right">
                    <span className="font-mono text-sm tabular-nums" style={{ color: v != null ? scoreHex(v) : "#334155" }}>
                      {v ?? "·"}
                    </span>
                    {d != null && d !== 0 && (
                      <span className="ml-1 font-mono text-xs tabular-nums" style={{ color: deltaHex(d) }}>
                        {d > 0 ? `+${d}` : d}
                      </span>
                    )}
                  </td>
                );
              })}
              <td className="px-2 py-1 text-right">
                <DeltaChip delta={r.delta} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-divider">
            <td className="sticky left-0 z-10 bg-surface px-2 py-1.5 font-mono text-xs uppercase tracking-widest text-slate-500">Fleet avg</td>
            {avgs.map((v, i) => (
              <td key={i} className="px-2 py-1.5 text-right font-mono text-sm font-bold tabular-nums" style={{ color: v != null ? scoreHex(v) : undefined }}>
                {v ?? "—"}
              </td>
            ))}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
