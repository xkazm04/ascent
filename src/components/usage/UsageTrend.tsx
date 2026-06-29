"use client";

// Per-day usage trend: billable (private) stacked over free (public) computed scans across
// the selected period, plus CSV/JSON export for finance reconciliation. Dependency-free
// inline SVG (same approach as the trends/delivery charts).

import type { UsageDay } from "@/lib/db";

const BILLABLE = "var(--color-accent)"; // billable (private) — brand accent token
const FREE = "#94a3b8"; // free (public) — one slate for legend swatch, bars, and summary text

export function UsageTrend({ daily, org, days }: { daily: UsageDay[]; org: string; days: number }) {
  const max = Math.max(1, ...daily.map((d) => d.billable + d.free));
  const totalBillable = daily.reduce((a, d) => a + d.billable, 0);
  const totalFree = daily.reduce((a, d) => a + d.free, 0);
  const exportBase = `/api/usage?org=${encodeURIComponent(org)}&days=${days}`;

  // Label cadence: avoid crowding the axis on long windows.
  const labelEvery = Math.max(1, Math.ceil(daily.length / 8));

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Computed scans per day</h2>
          <p className="mt-1 text-sm text-slate-500">
            Last {days} days · <span style={{ color: BILLABLE }}>{totalBillable} billable</span> ·{" "}
            <span style={{ color: FREE }}>{totalFree} free</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${exportBase}&format=csv`}
            className="focus-ring rounded-lg border border-slate-700 px-3 py-1.5 font-mono text-sm uppercase tracking-widest text-slate-200 transition hover:border-accent hover:text-white"
            download
          >
            Export CSV
          </a>
          <a
            href={`${exportBase}&format=json`}
            className="focus-ring rounded-lg border border-slate-700 px-3 py-1.5 font-mono text-sm uppercase tracking-widest text-slate-200 transition hover:border-accent hover:text-white"
            download
          >
            Export JSON
          </a>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4 text-sm text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: BILLABLE }} />
          Billable (private)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: FREE }} />
          Free (public)
        </span>
      </div>

      {totalBillable + totalFree === 0 ? (
        <p className="mt-6 text-base text-slate-500">No scans recorded in this period.</p>
      ) : (
        <>
          <div className="mt-4 flex h-40 items-end gap-px">
            {daily.map((d) => {
              const total = d.billable + d.free;
              const freeH = (d.free / max) * 100;
              const billH = (d.billable / max) * 100;
              return (
                <div
                  key={d.date}
                  className="group relative flex flex-1 cursor-help flex-col justify-end"
                  title={`${d.date}: ${d.billable} billable, ${d.free} free`}
                >
                  {d.billable > 0 && (
                    <div style={{ height: `${billH}%`, backgroundColor: BILLABLE }} className="rounded-t-sm transition group-hover:brightness-125" />
                  )}
                  {d.free > 0 && <div style={{ height: `${freeH}%`, backgroundColor: FREE }} className="transition group-hover:brightness-125" />}
                  {total === 0 && <div className="h-px bg-slate-800" />}
                </div>
              );
            })}
          </div>
          {/* One flex-1 slot per day, mirroring the bar grid above, so each shown label stays under
              its own bar. (A justify-between over only the filtered labels spread them evenly across
              the full width, detaching them from the fixed per-day bar positions.) */}
          <div className="mt-2 flex gap-px font-mono text-sm text-slate-600">
            {daily.map((d, i) => {
              const show = i % labelEvery === 0 || i === daily.length - 1;
              return (
                <span key={d.date} className="flex-1 text-center">
                  {show ? d.date.slice(5) : " "}
                </span>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
