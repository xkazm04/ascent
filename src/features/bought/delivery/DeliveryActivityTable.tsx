"use client";

// The <details> table twin beneath DeliveryActivityChart — extracted so that file stays under the
// 200-LOC cap (AGENTS.md).

import { fmtWeekYear } from "./deliveryActivityChartMath";

export function DeliveryActivityTable({ series, weekMs }: { series: number[]; weekMs: (i: number) => number }) {
  return (
    <details className="group mt-2">
      <summary className="focus-ring inline-flex cursor-pointer list-none items-center gap-2 rounded font-mono text-sm text-slate-500 transition hover:text-slate-300 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block text-slate-600 transition-transform group-open:rotate-90">›</span>
        Table view
      </summary>
      <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-divider">
        <table className="w-full text-sm">
          <caption className="sr-only">Weekly commit totals, newest first</caption>
          <thead className="bg-surface/60 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
            <tr>
              <th className="px-4 py-1.5 text-left">Week of</th>
              <th className="px-4 py-1.5 text-right">Commits</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {series
              .map((v, i) => ({ v, i }))
              .reverse()
              .map(({ v, i }) => (
                <tr key={i} className="text-slate-300">
                  <td className="px-4 py-1 font-mono">{fmtWeekYear.format(weekMs(i))}</td>
                  <td className="px-4 py-1 text-right font-mono tabular-nums">{v.toLocaleString()}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
