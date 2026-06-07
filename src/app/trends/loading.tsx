// App Router loading UI for /trends — shown while the server component fetches the repo's scan
// history, so navigating to trends shows the page's silhouette instead of a blank await (RT#4).
// Mirrors the content the page renders: a title, the overall-trend chart, and the dimension grid.
export default function TrendsLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10" aria-hidden>
      <div className="animate-pulse">
        <div className="h-3 w-28 rounded bg-slate-800" />
        <div className="mt-2 h-7 w-64 rounded bg-slate-800" />
        <div className="mt-8 h-[220px] w-full rounded-2xl border border-slate-800 bg-slate-900/40" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[150px] rounded-xl border border-slate-800 bg-slate-900/40" />
          ))}
        </div>
      </div>
    </main>
  );
}
