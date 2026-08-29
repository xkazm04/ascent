"use client";

// #16 — the repo × control grid. Column groups are check FAMILIES, collapsed by default and
// expandable to the individual clause (`control.prepush.test`), because a CISO opens this to ask
// "are the controls holding" and only then "which one".

import { OrgTable } from "@/components/org/shared/ui";
import { ControlCell } from "./ControlCell";
import { cellFor, columnTotals, columnsFor, type ControlMatrixRowView } from "./controlMatrixView";

export function ControlMatrixGrid({
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
    <OrgTable
      caption="Repositories by declared control"
      minWidth={420 + columns.length * 90}
      head={
        <tr>
          <th className="px-4 py-3 text-left">Repository</th>
          {columns.map((c) => {
            const totals = columnTotals(rows, c);
            const isFamilyHead = c.key === c.family;
            return (
              <th key={c.key} className="px-3 py-3 text-center">
                {isFamilyHead ? (
                  <button
                    type="button"
                    onClick={() => onToggleFamily(c.family)}
                    aria-expanded={expanded.has(c.family)}
                    className="focus-ring rounded px-1 font-mono text-xs uppercase tracking-[0.18em] text-slate-400 transition hover:text-slate-200"
                    title={`Expand ${c.family} into its individual checks`}
                  >
                    {c.label}
                  </button>
                ) : (
                  <span className="font-mono text-[11px] normal-case tracking-normal text-slate-400">{c.label}</span>
                )}
                <span className="mt-1 block font-mono text-[10px] normal-case tracking-normal text-slate-600">
                  {totals.fail > 0 ? `${totals.fail} failing` : totals.reporting > 0 ? `${totals.reporting} reporting` : "none reporting"}
                </span>
              </th>
            );
          })}
          <th className="px-4 py-3 text-left">Last report</th>
        </tr>
      }
    >
      {rows.map((row) => (
        <tr key={row.repoFullName}>
          <td className="px-4 py-2.5 font-mono text-sm text-slate-200">{row.repoFullName}</td>
          {columns.map((c) => (
            <ControlCell key={c.key} label={c.label} cell={cellFor(row, c)} />
          ))}
          <td className="px-4 py-2.5 text-sm text-slate-500">
            {row.reportedAt.slice(0, 10)}
            {row.summaryOnly && (
              <span
                className="ml-2 text-amber-400/80"
                title="This repository's doctor sent only summary numbers, so no clause-level result exists for it. Its cells are 'not judged', not passing."
              >
                summary-only (doctor &lt; 0.3.0)
              </span>
            )}
          </td>
        </tr>
      ))}
    </OrgTable>
  );
}
