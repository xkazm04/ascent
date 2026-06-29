// App Router loading UI for /report/{owner}/{repo} — streamed while the server awaits the pinned scan
// (a DB read, or the live-scan fallback) before it can render anything. Showing this shell instantly
// makes navigating to a report permalink (a register click, a shared link) feel SPA-instant instead of
// a blank await. This Suspense-streamed shell is also the exact foundation Next 16.3 Cache Components /
// Instant Navigations build on. Mirrors ReportView: title + level chip, score & radar, dimension bars.
export default function ReportLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10" aria-hidden>
      <div className="animate-pulse">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="h-3 w-24 rounded bg-slate-800" />
            <div className="mt-2 h-7 w-72 max-w-full rounded bg-slate-800" />
          </div>
          <div className="h-8 w-28 rounded-full bg-slate-800" />
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="h-[300px] rounded-2xl border border-slate-800 bg-slate-900/40" />
          <div className="h-[300px] rounded-2xl border border-slate-800 bg-slate-900/40" />
        </div>

        <div className="mt-8 space-y-3">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="h-4 w-40 max-w-[40%] rounded bg-slate-800" />
              <div className="h-2.5 flex-1 rounded-full bg-slate-900/60" />
              <div className="h-4 w-8 rounded bg-slate-800" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
