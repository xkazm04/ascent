// Pure layout math for DeliveryActivityChart — extracted so the chart's own JSX stays under the
// 200-LOC cap (AGENTS.md). `.ts` is uncapped by design (docs/ORG-TABS-REFACTOR.md §3).

export const WEEK_MS = 7 * 86_400_000;

// Fixed drawing frame (viewBox units). Height includes the x-axis band so labels never clip.
export const CHART_W = 920;
export const CHART_H = 216;
export const CHART_MARGIN = { left: 46, right: 10, top: 22, bottom: 26 };
export const INNER_W = CHART_W - CHART_MARGIN.left - CHART_MARGIN.right;
export const PLOT_H = CHART_H - CHART_MARGIN.top - CHART_MARGIN.bottom;
export const BASE_Y = CHART_MARGIN.top + PLOT_H;

// BRAND.md / /org redesign §2.5: colour is never picked by hand. These are the same two values the
// hand-written hexes used to spell out (`--color-accent` #3b9eff, `--color-accent-soft` #7bbcff), now
// read from the tokens so a palette change reaches this chart instead of passing it by.
export const ACCENT = "var(--color-accent)";
export const ACCENT_LIFT = "var(--color-accent-soft)";

export const fmtWeek = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
export const fmtWeekYear = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Snap a raw step up to the nearest "nice" 1/2/5×10^k so y-ticks land on clean numbers. */
export function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/** Bar path: square at the baseline, radius-r rounded data-end (top). */
export function barPath(x: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  const top = BASE_Y - h;
  return `M${x},${BASE_Y} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + w - r},${top} Q${x + w},${top} ${x + w},${top + r} L${x + w},${BASE_Y} Z`;
}
