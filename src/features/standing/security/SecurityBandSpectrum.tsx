// The fleet security spectrum — the D9 band distribution as ONE proportional bar with an inline
// legend, replacing the Security tab's former card-of-four-cards (same numbers, a fraction of the
// vertical space, and the fleet's shape is readable at a glance). Server-safe: pure render.

const BANDS = [
  { key: "critical", label: "critical", range: "<40", color: "#dc2626" },
  { key: "weak", label: "weak", range: "40–59", color: "#d97706" },
  { key: "ok", label: "ok", range: "60–79", color: "#3b9eff" },
  { key: "strong", label: "strong", range: "80+", color: "#16a34a" },
] as const;

export function SecurityBandSpectrum({
  band,
  scanned,
}: {
  band: { critical: number; weak: number; ok: number; strong: number };
  scanned: number;
}) {
  if (scanned === 0) return null;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-800" role="img" aria-label={aria(band, scanned)}>
        {BANDS.filter((b) => band[b.key] > 0).map((b) => (
          <div
            key={b.key}
            className="h-full transition-all"
            style={{ width: `${(band[b.key] / scanned) * 100}%`, backgroundColor: b.color }}
            title={`${band[b.key]} ${b.label} (${b.range})`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm text-slate-400">
        {BANDS.map((b) => (
          <span key={b.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: band[b.key] > 0 ? b.color : "#334155" }} />
            <span className="tabular-nums" style={{ color: band[b.key] > 0 ? undefined : "#64748b" }}>
              {band[b.key]} {b.label} <span className="text-slate-600">({b.range})</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function aria(band: { critical: number; weak: number; ok: number; strong: number }, scanned: number): string {
  return `Security distribution across ${scanned} repos: ${band.critical} critical, ${band.weak} weak, ${band.ok} ok, ${band.strong} strong`;
}
