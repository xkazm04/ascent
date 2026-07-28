"use client";

import type { HistoryPoint } from "@/lib/db/scans";
import { addDaysInZone } from "@/lib/org/timezone";

export const RANGES = [
  { key: "5d", label: "5d", days: 5 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "all", label: "All", days: null },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

/**
 * Start of the "last `days` days" window, in the canonical org zone: the zoned midnight `days - 1`
 * calendar days before today, so "5d" means today plus the four calendar days before it. Calendar
 * arithmetic (`addDaysInZone`), never `days × 86_400_000` — a DST day is 23 or 25 hours, and a flat
 * multiply silently slid the boundary an hour into the neighbouring day twice a year. The window is
 * HALF-OPEN at the bottom (`t >= cutoff`) and unbounded at the top, so a clock-skewed future-dated
 * scan is still shown rather than filtered into invisibility. (Canonical time-zone policy,
 * `src/lib/org/timezone.ts`.)
 */
export function rangeCutoff(days: number, now: Date = new Date()): Date {
  return addDaysInZone(now, -(days - 1));
}

/** Keep scans within `days` of now (newest-first order preserved); `null` keeps all. */
export function withinRange(scans: HistoryPoint[], days: number | null): HistoryPoint[] {
  if (days === null) return scans;
  const cutoff = rangeCutoff(days).getTime();
  return scans.filter((s) => {
    const t = Date.parse(s.scannedAt);
    // An undateable point has, by definition, no place in a time window — excluding it lets the user
    // narrow it out of view (previously it stuck in every 5d/30d/90d range as a floating dot with a
    // blank x-label). The "keep all" path above still preserves NaN-date points for `days === null`.
    return Number.isNaN(t) ? false : t >= cutoff;
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
