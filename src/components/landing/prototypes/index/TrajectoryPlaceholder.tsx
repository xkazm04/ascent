// Shared at-rest / loading placeholder for the levels trajectory chart. Rendered in TWO places that
// used to diverge and make the slot visibly jump: the dynamic-import loading fallback (IndexLevels,
// while the recharts chunk streams in) AND the chart's own pre-in-view at-rest state (TrajectoryChart,
// before it scrolls into view and animates). Single-sourced here so both are pixel-identical. Kept in
// this light module (no recharts import) so IndexLevels can reference it WITHOUT pulling the heavy
// chart chunk into the homepage's first load.
export function TrajectoryPlaceholder() {
  return <div className="h-[360px] w-full animate-pulse rounded-xl bg-slate-900/40" />;
}
