"use client";

// The <details> table twin beneath DeliveryActivityChart — extracted so that file stays under the
// 200-LOC cap (AGENTS.md).

import { DataTable } from "@/components/kit";
import { fmtWeekYear } from "./deliveryActivityChartMath";

export function DeliveryActivityTable({ series, weekMs }: { series: number[]; weekMs: (i: number) => number }) {
  return (
    <details className="group mt-2">
      <summary className="focus-ring inline-flex cursor-pointer list-none items-center gap-2 rounded type-mono-sm text-slate-500 transition hover:text-slate-300 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block text-slate-600 transition-transform group-open:rotate-90">›</span>
        Table view
      </summary>
      <DataTable
        size="sm"
        minWidth={0}
        className="mt-2 max-h-64 overflow-y-auto"
        caption="Weekly commit totals, newest first"
        head={
          <tr>
            <th className="px-4 py-1.5 text-left">Week of</th>
            <th className="px-4 py-1.5 text-right">Commits</th>
          </tr>
        }
      >
        {series
          .map((v, i) => ({ v, i }))
          .reverse()
          .map(({ v, i }) => (
            <tr key={i} className="text-slate-300">
              <td className="px-4 py-1 font-mono">{fmtWeekYear.format(weekMs(i))}</td>
              <td className="px-4 py-1 text-right font-mono tabular-nums">{v.toLocaleString()}</td>
            </tr>
          ))}
      </DataTable>
    </details>
  );
}
