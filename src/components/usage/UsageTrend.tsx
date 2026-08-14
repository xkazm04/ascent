"use client";

// Per-day usage trend: billable (private) stacked over free (public) computed scans across
// the selected period, plus CSV/JSON export for finance reconciliation. Dependency-free flex DIV
// bars (NOT inline SVG like the trends/delivery charts — an earlier comment claimed otherwise, which
// hid that none of the SVG charts' a11y affordances came along). Because the per-day values only
// surface via hover `title` tooltips, the bar strip is exposed as one labeled image and a
// visually-hidden table carries the full day-by-day data for keyboard/touch/screen-reader users.

import type { UsageDay } from "@/lib/db";

const BILLABLE = "var(--color-accent)"; // billable (private) — brand accent token
const FREE = "var(--color-tone-flat)"; // free (public) — slate-400, the token already defined in globals.css (matches the prior #94a3b8 literal exactly), reused for legend swatch, bars, and summary text

/**
 * Above this many days, render WEEKLY aggregates instead of per-day bars. The data layer
 * (boundUsageDays, src/lib/db/usage.ts) deliberately allows authenticated orgs up to 365 days, but
 * one flex-1 column + 1px gap per day degenerates there: the gaps alone eat 364px, every bar is
 * sub-pixel, hover targets are un-hittable, and the MM-DD axis repeats itself across the year.
 * ~120 days is where per-day bars stop being individually readable in the page's content column.
 */
export const BUCKET_THRESHOLD_DAYS = 120;

/**
 * Pure presentation bucketing for long windows: consecutive 7-day chunks summed per series, keyed by
 * the chunk's first date. Sums are preserved exactly; the CSV/JSON exports stay per-day (the escape
 * hatch for exact figures). Exported for tests.
 */
export function bucketUsageDays(daily: UsageDay[]): { series: UsageDay[]; bucketed: boolean } {
  if (daily.length <= BUCKET_THRESHOLD_DAYS) return { series: daily, bucketed: false };
  const series: UsageDay[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    series.push({
      date: chunk[0]!.date,
      billable: chunk.reduce((a, d) => a + d.billable, 0),
      free: chunk.reduce((a, d) => a + d.free, 0),
    });
  }
  return { series, bucketed: true };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Axis label: MM-DD per-day (short windows), `MMM 'yy` when bucketed — a 365-day window starts and
 *  ends on the same MM-DD, so year-less labels were ambiguous exactly where long windows render. */
function axisLabel(date: string, bucketed: boolean): string {
  if (!bucketed) return date.slice(5);
  const [y = "", m = "1"] = date.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} '${y.slice(2)}`;
}

export function UsageTrend({ daily, org, days }: { daily: UsageDay[]; org: string; days: number }) {
  const { series, bucketed } = bucketUsageDays(daily);
  const max = Math.max(1, ...series.map((d) => d.billable + d.free));
  const totalBillable = daily.reduce((a, d) => a + d.billable, 0);
  const totalFree = daily.reduce((a, d) => a + d.free, 0);
  const exportBase = `/api/usage?org=${encodeURIComponent(org)}&days=${days}`;

  // Label cadence: avoid crowding the axis on long windows.
  const labelEvery = Math.max(1, Math.ceil(series.length / 8));

  return (
    <div className="rounded-2xl border border-divider bg-surface/40 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">
            Computed scans per {bucketed ? "week" : "day"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Last {days} days · <span style={{ color: BILLABLE }}>{totalBillable} billable</span> ·{" "}
            <span style={{ color: FREE }}>{totalFree} free</span>
            {/* Long windows are bucketed for readability — say so, and point at the escape hatch. */}
            {bucketed && <> · showing weekly totals (per-day figures in the CSV/JSON export)</>}
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
          {/* The hover-only tooltips never fire for keyboard/touch/AT users, so the billing data —
              the numbers users reconcile invoices against — gets a text alternative: a summary on the
              image role plus a visually-hidden per-day table (and the Export CSV link above). */}
          <div
            className="mt-4 flex h-40 items-end gap-px"
            role="img"
            aria-label={`${bucketed ? "Weekly" : "Daily"} computed scans, last ${days} days: ${totalBillable} billable, ${totalFree} free. Full figures in the table that follows, or via Export CSV.`}
          >
            {series.map((d) => {
              const total = d.billable + d.free;
              const freeH = (d.free / max) * 100;
              const billH = (d.billable / max) * 100;
              return (
                <div
                  key={d.date}
                  className="group relative flex flex-1 cursor-help flex-col justify-end"
                  title={`${bucketed ? `Week of ${d.date}` : d.date}: ${d.billable} billable, ${d.free} free`}
                >
                  {d.billable > 0 && (
                    <div style={{ height: `${billH}%`, backgroundColor: BILLABLE }} className="rounded-t-sm transition group-hover:brightness-125" />
                  )}
                  {/* Round whichever segment is on top: when there's no billable cap above it, the free
                      segment is the crown of the bar and takes the same rounded top the billable cap has,
                      so free-only days don't read as square-topped next to rounded billable days. */}
                  {d.free > 0 && (
                    <div
                      style={{ height: `${freeH}%`, backgroundColor: FREE }}
                      className={`transition group-hover:brightness-125 ${d.billable > 0 ? "" : "rounded-t-sm"}`}
                    />
                  )}
                  {total === 0 && <div className="h-px bg-slate-800" />}
                </div>
              );
            })}
          </div>
          {/* One flex-1 slot per day, mirroring the bar grid above, so each shown label stays under
              its own bar. (A justify-between over only the filtered labels spread them evenly across
              the full width, detaching them from the fixed per-day bar positions.) */}
          <div className="mt-2 flex gap-px font-mono text-sm text-slate-600" aria-hidden="true">
            {series.map((d, i) => {
              const show = i % labelEvery === 0 || i === series.length - 1;
              return (
                <span key={d.date} className="flex-1 text-center">
                  {show ? axisLabel(d.date, bucketed) : " "}
                </span>
              );
            })}
          </div>
          {/* Text alternative for the bar strip: every day the hover tooltips carry, reachable by AT. */}
          <table className="sr-only">
            <caption>
              Computed scans per {bucketed ? "week (weekly totals; per-day figures via the CSV export)" : "day"}:
              billable (private) and free (public)
            </caption>
            <thead>
              <tr>
                <th scope="col">{bucketed ? "Week of" : "Date"}</th>
                <th scope="col">Billable</th>
                <th scope="col">Free</th>
              </tr>
            </thead>
            <tbody>
              {series.map((d) => (
                <tr key={d.date}>
                  <th scope="row">{d.date}</th>
                  <td>{d.billable}</td>
                  <td>{d.free}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
