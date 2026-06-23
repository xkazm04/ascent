// Static shimmer silhouette of a report — a ScoreRing placeholder + dimension bars. Shown as the
// Suspense fallback for the report route (first paint / slow hydration) and reused inside
// ReportClient's live Loading view, so the very first frame already shows the report's shape
// instead of a bare "Loading…" line that then snaps to the polished checklist.

export function ReportSkeleton() {
  return (
    <div className="w-full space-y-3" aria-hidden data-testid="report-skeleton">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 animate-pulse rounded-full bg-slate-800" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 animate-pulse rounded bg-slate-800" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-slate-800/70" />
        </div>
      </div>
      <div className="space-y-2 pt-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-3 w-20 animate-pulse rounded bg-slate-800/70" />
            <div className="h-2 flex-1 animate-pulse rounded-full bg-slate-800" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The skeleton in its centered Suspense-fallback wrapper, shared by the report search + permalink
 *  routes so the fallback layout lives in one place. */
export function ReportSkeletonFallback() {
  return (
    <div className="mx-auto w-full max-w-md py-12">
      <ReportSkeleton />
    </div>
  );
}
