// Pure geometry + formatting for DeliveryTrendPanel — extracted so the panel's JSX stays inside the
// 200-LOC cap that governs everything under src/features/** (AGENTS.md).
//
// `trendPath` is the load-bearing one: it BREAKS the path wherever a day has no measurement. That
// break is the encoding the /org redesign law asks for — "an em dash is a missing measurement, not a
// zero" cannot be enforced by a sentence, but a line that has no point to draw at 0 offers the reader
// no zero to mistake (docs/ORG-UX-REDESIGN.md §2.4, `missing`).

/** One day of one metric, plus the sample size behind it (disclosed in the tooltip). */
export interface TrendPanelPoint {
  date: string;
  value: number | null;
  mock: boolean;
  scans: number;
  repos: number;
}

export const TREND_W = 320;
export const TREND_H = 84;
export const TREND_PAD_TOP = 8;
export const TREND_PAD_BOTTOM = 8;

// A point's `date` is a canonical-zone DAY KEY ("2026-07-14"), not an instant. `shortDateSafe` would
// parse it as UTC midnight and format it in the VIEWER's zone — printing "Jul 13" west of Greenwich
// and, worse, disagreeing between the server prerender and the client hydration. Pin the formatter to
// UTC and en-US so the label is exactly the day key it came from, everywhere.
const fmtDayKey = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function dayLabel(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? key : fmtDayKey.format(d);
}

/** Snap a raw max up to a "nice" 1/2/5×10^k so the hours axis lands on a readable ceiling. */
export function niceMax(raw: number): number {
  if (!(raw > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/**
 * The polyline, with a GAP at every unmeasured day. Bridging through a null would draw a
 * crash-and-recover that never happened, which is precisely the reading the void state forbids.
 */
export function trendPath(
  points: { value: number | null }[],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  let path = "";
  let pen = false;
  for (let i = 0; i < points.length; i++) {
    const v = points[i]?.value;
    if (v == null) {
      pen = false;
      continue;
    }
    path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
  }
  return path.trim();
}

/** How many days in this series carry no measurement at all — the count the legend states. */
export function voidDays(points: { value: number | null }[]): number {
  return points.reduce((n, p) => (p.value == null ? n + 1 : n), 0);
}
