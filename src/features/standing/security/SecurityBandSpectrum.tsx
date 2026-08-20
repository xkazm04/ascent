// The fleet security spectrum — the D9 band distribution as ONE proportional bar with an inline
// legend, replacing the Security tab's former card-of-four-cards (same numbers, a fraction of the
// vertical space, and the fleet's shape is readable at a glance). Server-safe: pure render.
//
// It is no longer a section of its own. It renders as the LAST CELL of the tab's summary-tile ledger
// (`col-span-full`, so the ledger's `gap-px` bed puts it flush under the four tiles as their bottom
// edge): the thin coloured bar takes the place of the frame's plain bottom border, so the shape of the
// fleet reads as part of the same instrument as the numbers above it rather than as a floating strip
// below. It must therefore be a DIRECT child of the TILE_GRID element, and it paints `bg-ink` like
// every other cell so the hairline bed shows only as a rule.
//
// The legend stays. The bar alone would be a colour-only signal, and the counts are the point.

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
  // Nothing scanned: render no cell at all, and the ledger closes with its own bottom border as usual.
  if (scanned === 0) return null;
  return (
    <div className="col-span-full bg-ink">
      <div className="flex h-1.5" role="img" aria-label={aria(band, scanned)}>
        {BANDS.filter((b) => band[b.key] > 0).map((b) => (
          <div
            key={b.key}
            className="h-full transition-all"
            style={{ width: `${(band[b.key] / scanned) * 100}%`, backgroundColor: b.color }}
            title={`${band[b.key]} ${b.label} (${b.range})`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-2 font-mono text-xs text-slate-400">
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
