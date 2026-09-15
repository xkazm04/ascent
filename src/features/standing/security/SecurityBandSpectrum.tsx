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
//
// Colour comes from `scoreHex` at each band's midpoint, never a hand-picked hex (ORG-UX-REDESIGN §2.5,
// BRAND.md). The four literals that used to sit here included a BLUE for "ok" — off the red→green
// maturity ramp entirely, so this one bar taught a fifth colour meaning that contradicted every score
// ring, heat cell and D9 chip beside it. Routing through the rubric also means a retuned level band
// retunes this bar automatically instead of silently desyncing.

import { scoreHex } from "@/lib/ui";

const BANDS = [
  { key: "critical", label: "critical", range: "<40", mid: 20 },
  { key: "weak", label: "weak", range: "40–59", mid: 50 },
  { key: "ok", label: "ok", range: "60–79", mid: 70 },
  { key: "strong", label: "strong", range: "80+", mid: 90 },
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
            style={{ width: `${(band[b.key] / scanned) * 100}%`, backgroundColor: scoreHex(b.mid) }}
            title={`${band[b.key]} ${b.label} (D9 ${b.range})`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-2 type-caption text-slate-400">
        {BANDS.map((b) => (
          <span key={b.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: band[b.key] > 0 ? scoreHex(b.mid) : "var(--color-divider)" }} />
            <span className={`tabular-nums ${band[b.key] > 0 ? "" : "text-slate-500"}`}>
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
