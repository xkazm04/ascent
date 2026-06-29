// App Router loading UI for the org dashboard segment — covers every org sub-tab (Executive,
// Governance, Adoption, Delivery, Security, Plan, …) since it has no loading.tsx of its own. The org
// layout (site header + maturity chip + section rail) stays mounted across a client-side tab switch, so
// streaming just this content-column skeleton makes switching tabs feel instant instead of blanking on
// the per-tab data fetch. The same Suspense-streamed shell that Next 16.3 Cache Components builds on.
// Rendered into the layout's content slot (right of the OrgNav rail), so it skeletons only the page body.
export default function OrgLoading() {
  return (
    <div className="animate-pulse" aria-hidden>
      <div className="h-3 w-28 rounded bg-slate-800" />
      <div className="mt-2 h-7 w-72 max-w-full rounded bg-slate-800" />
      <div className="mt-3 h-4 w-full max-w-xl rounded bg-slate-900/70" />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-xl border border-slate-800 bg-slate-900/40" />
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="h-64 rounded-2xl border border-slate-800 bg-slate-900/40" />
        <div className="h-64 rounded-2xl border border-slate-800 bg-slate-900/40" />
      </div>
    </div>
  );
}
