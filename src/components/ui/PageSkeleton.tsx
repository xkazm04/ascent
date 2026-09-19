// Shared App Router loading skeleton for content-heavy pages that fetch server-side. Rendered as a
// Suspense-streamed shell (via a segment loading.tsx) so navigating to the page shows structure instantly
// instead of a blank/blocked transition on the data fetch. Static + server-safe (no hooks, no client JS);
// aria-hidden so assistive tech skips the placeholder. The same idiom as the org dashboard's loading.tsx.
export default function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl animate-pulse px-5 py-10" aria-hidden>
      <div className="h-3 w-28 rounded bg-slate-800" />
      <div className="mt-2 h-8 w-80 max-w-full rounded bg-slate-800" />
      <div className="mt-3 h-4 w-full max-w-xl rounded bg-slate-900/70" />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-xl border border-slate-800 bg-slate-900/40" />
        ))}
      </div>

      <div className="mt-6 h-72 rounded-2xl border border-slate-800 bg-slate-900/40" />
    </div>
  );
}
