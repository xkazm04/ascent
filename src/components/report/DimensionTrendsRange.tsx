"use client";

import type { HistoryPoint } from "@/lib/db/scans";

export const RANGES = [
  { key: "5d", label: "5d", days: 5 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "all", label: "All", days: null },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

/** Keep scans within `days` of now (newest-first order preserved); `null` keeps all. */
export function withinRange(scans: HistoryPoint[], days: number | null): HistoryPoint[] {
  if (days === null) return scans;
  const cutoff = Date.now() - days * 86_400_000;
  return scans.filter((s) => {
    const t = Date.parse(s.scannedAt);
    return Number.isNaN(t) ? true : t >= cutoff;
  });
}

export function RangeToggle({ value, onChange }: { value: RangeKey; onChange: (k: RangeKey) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-divider bg-surface/60 p-0.5 font-mono text-sm">
      {RANGES.map((r) => {
        const active = r.key === value;
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => onChange(r.key)}
            aria-pressed={active}
            className={`rounded-md px-2.5 py-1 uppercase tracking-wider transition ${
              active ? "bg-accent text-on-accent" : "text-slate-400 hover:text-white"
            }`}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
