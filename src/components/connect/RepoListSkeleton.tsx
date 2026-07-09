/** Skeleton that mirrors the loaded panel's FULL vertical footprint — the header row, credit strip,
 *  bulk-actions bar, and filter bar that all sit ABOVE the list (see InstallationRepos.tsx) — not just
 *  the rows. Modelling only the list made the whole list snap down several rows the instant data landed
 *  (the exact CLS this was meant to prevent). Announced to assistive tech via `role="status"` +
 *  `aria-busy` with an SR-only label, so the fetch isn't dead air followed by a silent content swap;
 *  the purely-decorative pulse bars are `aria-hidden`. */
export function RepoListSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading repositories…</span>
      <div aria-hidden>
        {/* Header row: "N of M watched" + Org dashboard link. */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="h-5 w-40 animate-pulse rounded bg-slate-800" />
          <div className="h-7 w-32 animate-pulse rounded-lg bg-slate-800/70" />
        </div>
        {/* Credit-cost strip (single line). */}
        <div className="-mt-2 mb-3 h-4 w-72 max-w-full animate-pulse rounded bg-slate-800/60" />
        {/* Bulk-actions bar: watch-all button + cadence select. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="h-8 w-28 animate-pulse rounded-lg bg-slate-800/70" />
          <div className="h-8 w-40 animate-pulse rounded-md bg-slate-800/70" />
        </div>
        {/* Filter bar: search input + visibility chips. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="h-10 min-w-[12rem] flex-1 animate-pulse rounded-lg bg-slate-800/70" />
          <div className="h-7 w-14 animate-pulse rounded-full bg-slate-800/70" />
          <div className="h-7 w-16 animate-pulse rounded-full bg-slate-800/70" />
          <div className="h-7 w-16 animate-pulse rounded-full bg-slate-800/70" />
          <div className="h-7 w-20 animate-pulse rounded-full bg-slate-800/70" />
        </div>
        {/* Repo rows — mirror the real row layout so the list keeps a stable height. */}
        <div className="divide-y divide-divider overflow-hidden rounded-xl border border-divider bg-surface/40">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <div className="min-w-0 flex-1">
                <div className="h-4 w-48 animate-pulse rounded bg-slate-800" />
                <div className="mt-2 h-3 w-32 animate-pulse rounded bg-slate-800/70" />
              </div>
              <div className="h-4 w-12 animate-pulse rounded bg-slate-800/70" />
              <div className="h-7 w-24 animate-pulse rounded-md bg-slate-800/70" />
              <div className="h-8 w-16 animate-pulse rounded-lg bg-slate-800/70" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
