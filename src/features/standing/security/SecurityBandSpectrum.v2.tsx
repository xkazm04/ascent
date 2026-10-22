// The fleet security spectrum, Prism composition: the D9 band distribution as one proportional bar with its
// counts spelled out, set under the masthead instead of as the last cell of a tile ledger. The bar's colours
// come from `scoreHex` at each band midpoint (the shared red-to-green score ramp), and the legend names every
// band in words, so no band is colour alone. Server-safe.
import { scoreHex } from "@/lib/ui";

const BANDS = [
  { key: "critical", label: "critical", range: "below 40", mid: 20 },
  { key: "weak", label: "weak", range: "40 to 59", mid: 50 },
  { key: "ok", label: "ok", range: "60 to 79", mid: 70 },
  { key: "strong", label: "strong", range: "80 and up", mid: 90 },
] as const;

type Band = { critical: number; weak: number; ok: number; strong: number };

export function SecurityBandSpectrumV2({ band, scanned }: { band: Band; scanned: number }) {
  if (scanned === 0) return null;
  const label = `Security distribution across ${scanned} repos: ${band.critical} critical, ${band.weak} weak, ${band.ok} ok, ${band.strong} strong`;
  return (
    <div data-role="band-spectrum" className="space-y-3">
      <div className="flex h-1.5 gap-px overflow-hidden rounded-[2px]" role="img" aria-label={label}>
        {BANDS.filter((b) => band[b.key] > 0).map((b) => (
          <div key={b.key} className="h-full" style={{ width: `${(band[b.key] / scanned) * 100}%`, backgroundColor: scoreHex(b.mid) }} title={`${band[b.key]} ${b.label} (D9 ${b.range})`} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-1 type-caption text-slate-300">
        {BANDS.map((b) => (
          <li key={b.key} className={band[b.key] > 0 ? "" : "text-slate-500"}>
            <span className="tabular-nums text-white">{band[b.key]}</span> {b.label} <span className="text-slate-400">({b.range})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
