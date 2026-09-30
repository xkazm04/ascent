"use client";

// Prism doctor-check ledger. Same columns and the same family expand as the Altimeter grid.
import { DataTable } from "@/components/kit";
import { ControlCellV2 } from "./ControlCell.v2";
import { cellFor, columnTotals, columnsFor, type ControlMatrixRowView } from "./controlMatrixView";

export function ControlMatrixGridV2({
  rows,
  expanded,
  onToggleFamily,
}: {
  rows: ControlMatrixRowView[];
  expanded: Set<string>;
  onToggleFamily: (family: string) => void;
}) {
  const columns = columnsFor(rows, expanded);
  return (
    <DataTable
      density="compact"
      stickyHead="page"
      stickyFirstCol
      minWidth={420 + columns.length * 110}
      caption="Repositories by declared control"
      labelledBy="doctor-checks-heading"
      head={
        <tr>
          <th className="px-3 py-2 text-left">Repository</th>
          {columns.map((c) => {
            const totals = columnTotals(rows, c);
            const isFamilyHead = c.key === c.family;
            const tally = totals.fail > 0 ? `${totals.fail} failing` : totals.reporting > 0 ? `${totals.reporting} reporting` : "none reporting";
            return (
              <th key={c.key} className="px-3 py-2 text-center">
                {isFamilyHead ? (
                  <button
                    type="button"
                    onClick={() => onToggleFamily(c.family)}
                    aria-expanded={expanded.has(c.family)}
                    className="focus-ring rounded px-1 text-slate-400"
                    title={`Expand ${c.family} into its individual checks`}
                  >
                    {c.label}
                  </button>
                ) : (
                  <span className="font-mono text-[0.8125rem] text-slate-400">{c.label}</span>
                )}
                <span className="mt-1 block type-caption text-slate-400">{tally}</span>
              </th>
            );
          })}
          <th className="px-3 py-2 text-left">Last report</th>
        </tr>
      }
    >
      {rows.map((row) => (
        <tr key={row.repoFullName}>
          <td className="whitespace-nowrap px-3 py-2 text-slate-200">{row.repoFullName}</td>
          {columns.map((c) => (
            <ControlCellV2 key={c.key} label={c.label} cell={cellFor(row, c)} />
          ))}
          <td className="whitespace-nowrap px-3 py-2 text-slate-400">
            {row.reportedAt.slice(0, 10)}
            {row.summaryOnly && (
              <span className="ml-2 text-slate-400" title="This repository's doctor sent only summary numbers, so no clause-level result exists for it. Its cells are not judged, not passing.">
                summary-only (doctor &lt; 0.3.0)
              </span>
            )}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
