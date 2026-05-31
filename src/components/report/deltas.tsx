// Shared score-delta chips — one red/green visual language for "what moved" across the
// report headline, the trend panel, and the "What changed" compare view. Pure presentational
// (no hooks/browser APIs), so it renders in both Server and Client Components.

/**
 * A rounded pill summarizing a points delta: green ▲ for a gain, red ▼ for a loss, neutral
 * "no change" at zero. `suffix` appends context (e.g. "since last scan"); `className` lets
 * the caller own spacing.
 */
export function DeltaPill({
  delta,
  suffix,
  className = "",
}: {
  delta: number;
  suffix?: string;
  className?: string;
}) {
  if (delta === 0) {
    return (
      <span
        className={`rounded-full border border-slate-600/40 bg-slate-500/10 px-2.5 py-1 text-xs text-slate-300 ${className}`}
      >
        no change{suffix ? ` ${suffix}` : ""}
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
        up
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-red-500/40 bg-red-500/10 text-red-300"
      } ${className}`}
    >
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {delta} pts{suffix ? ` ${suffix}` : ""}
    </span>
  );
}

/**
 * Compact inline delta tag (▲+N / ▼N) for dense rows like dimension cards. Renders a neutral
 * "—" at zero unless `hideZero` is set, in which case it renders nothing.
 */
export function DeltaTag({
  delta,
  hideZero = false,
  className = "",
}: {
  delta: number;
  hideZero?: boolean;
  className?: string;
}) {
  if (delta === 0) {
    if (hideZero) return null;
    return <span className={`text-xs font-semibold text-slate-500 ${className}`}>—</span>;
  }
  const up = delta > 0;
  return (
    <span
      className={`text-xs font-semibold tabular-nums ${up ? "text-emerald-400" : "text-red-400"} ${className}`}
    >
      {up ? "▲+" : "▼"}
      {delta}
    </span>
  );
}
