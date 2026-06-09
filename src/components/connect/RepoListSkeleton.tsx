/** Skeleton rows that mirror the real row layout, so the panel keeps a stable height and
 *  signals structure before GitHub responds (no spinner → snap-in layout shift). */
export function RepoListSkeleton() {
  return (
    <div>
      <div className="mb-3 h-4 w-40 animate-pulse rounded bg-slate-800" />
      <div
        className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40"
        aria-hidden
      >
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
  );
}
