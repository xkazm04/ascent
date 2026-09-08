"use client";

// Fleet-evolution timetable view (the "Index" reading): typeset colored numerals on a hairline grid,
// each score inked by its level via scoreHex, with the per-scan run-over-run delta beside it (the
// efficiency differentiator — how much THAT scan moved the score). Sticky first column; fleet-avg
// footer; the trailing Δ column is the whole-window evolution.
//
// A cell the repo has no scan for is a VOID, not a low score. It used to print a "·" in a hand-picked
// slate, while the fleet-average footer printed an em dash for the same condition — two glyphs for one
// meaning, neither of them explained anywhere on the wall. Both now draw the kit's `missing` mark
// (`StateSwatch`, the broken rule with the gap between its stubs), which carries the caveat in its
// aria-label and gets a legend row under the table whenever the grid actually contains one. The score
// ramp itself stays `scoreHex` — a level is an ordinal identity, and the kit does not replace it.

import { scoreHex } from "@/lib/ui";
import { Kicker, deltaHex } from "@/components/ui";
import { Legend } from "@/components/org/viz";
import { columnAverages } from "@/features/inflight/live/fleetTimetable";
import { DeltaChip, NoScan, RepoCheck, type TimetableView } from "@/features/inflight/live/LiveWarRoomTimetable";

export function TimetableLedger({ data, selected, onToggle, readOnly }: TimetableView) {
  const avgs = columnAverages(data);
  // Only legend a state the grid actually contains — the kit's rule, and the reason a fully-scanned
  // fleet is not taught an encoding it cannot see.
  const hasVoid = data.rows.some((r) => r.cells.some((c) => c == null)) || avgs.some((v) => v == null);
  return (
    <div className="overflow-x-auto p-4">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-divider">
            <th className="sticky left-0 z-10 bg-surface px-2 py-1.5 text-left">
              <Kicker tone="muted">Repo</Kicker>
            </th>
            {data.columns.map((c) => (
              <th key={c.key} className="px-2 py-1.5 text-right type-label tracking-widest text-slate-500">
                {c.label}
              </th>
            ))}
            <th className="px-2 py-1.5 text-right type-label tracking-widest text-slate-500">Δ</th>
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
                    {v == null ? (
                      <NoScan subject={`${r.name} · ${data.columns[i]?.label ?? "this day"}`} />
                    ) : (
                      <span className="type-mono-sm tabular-nums" style={{ color: scoreHex(v) }}>
                        {v}
                      </span>
                    )}
                    {d != null && d !== 0 && (
                      <span className="ml-1 type-caption tabular-nums" style={{ color: deltaHex(d) }}>
                        {d > 0 ? `+${d}` : d}
                      </span>
                    )}
                  </td>
                );
              })}
              <td className="px-2 py-1 text-right">
                <DeltaChip delta={r.delta} subject={r.name} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-divider">
            <td className="sticky left-0 z-10 bg-surface px-2 py-1.5 type-label tracking-widest text-slate-500">Fleet avg</td>
            {avgs.map((v, i) => (
              <td key={i} className="px-2 py-1.5 text-right type-mono-sm font-bold tabular-nums" style={{ color: v != null ? scoreHex(v) : undefined }}>
                {/* The mean of nothing is null, and a null mean draws the same void every cell above
                    it draws — not an em dash the eye rounds to zero. */}
                {v == null ? <NoScan subject={`Fleet average · ${data.columns[i]?.label ?? "this day"}`} /> : v}
              </td>
            ))}
            <td />
          </tr>
        </tfoot>
      </table>
      {hasVoid && <Legend className="mt-3" states={["missing"]} />}
    </div>
  );
}
