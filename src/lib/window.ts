// Time-range windows for the org dashboard. A window does double duty: it bounds the trend /
// movers to a period, AND it fixes the *baseline date* for period-over-period deltas — the
// fleet snapshot the present is compared against ("AI Adoption 62 ▲+8 vs last quarter").
//
// Pure + isomorphic: safe to import in server components (the date math) and in the client
// selector (which only needs RANGE_OPTIONS / DEFAULT_RANGE).

export type RangeKey = "30d" | "90d" | "quarter" | "all" | "custom";

export interface RangeOption {
  key: RangeKey;
  label: string; // selector button text
}

/** Presets surfaced by the selector, in display order. `custom` reveals two date inputs. */
export const RANGE_OPTIONS: RangeOption[] = [
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "quarter", label: "Quarter" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

// 90 days is the default: long enough that the period-over-period deltas mean something out of
// the box, short enough to read as "recent momentum". "All time" is the escape hatch back to the
// full history (no baseline, no deltas — the pre-window behavior).
export const DEFAULT_RANGE: RangeKey = "90d";

// OVR-5 — "remember my period": the selector writes the last-chosen window to this cookie and the
// overview reads it as the fallback (below an explicit ?range=, so shared URLs stay authoritative).
export const PERIOD_COOKIE = "ascent_period";

/** Serialize a chosen window for the period cookie (`custom|from|to` for custom, else the range key). */
export function serializePeriodCookie(sel: { range: RangeKey; from?: string; to?: string }): string {
  return sel.range === "custom" ? `custom|${sel.from ?? ""}|${sel.to ?? ""}` : sel.range;
}

/** Parse the period cookie into resolveWindow params; null when empty or an unknown range. */
export function parsePeriodCookie(v: string | undefined): { range?: string; from?: string; to?: string } | null {
  if (!v) return null;
  const [range, from, to] = v.split("|");
  if (!range || !RANGE_OPTIONS.some((o) => o.key === range)) return null;
  return { range, from: from || undefined, to: to || undefined };
}

export interface ResolvedWindow {
  key: RangeKey;
  /** Window start — also the baseline date for deltas. null = all-time (no baseline / no deltas). */
  start: Date | null;
  /** Window end. null = now (open-ended). */
  end: Date | null;
  /** Human label for the period, e.g. "Last 90 days". */
  title: string;
  /** Short suffix on tile deltas, e.g. "vs 90d ago". Empty when there's no comparison. */
  comparisonLabel: string;
  /** Heading for the period-in-review banner, e.g. "Quarter in review". */
  reviewTitle: string;
  /** Echoed custom-range inputs (yyyy-mm-dd) so the selector can repopulate them. */
  from?: string;
  to?: string;
}

const DAY = 86_400_000;

/** First day of the calendar quarter containing `now`, at local midnight. */
function startOfQuarter(now: Date): Date {
  const q = Math.floor(now.getMonth() / 3);
  return new Date(now.getFullYear(), q * 3, 1);
}

/** Parse a yyyy-mm-dd input into a local-midnight Date, or null when blank/invalid. */
function parseDay(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Resolve the `?range=…&from=…&to=…` search params into a concrete window. Unknown ranges fall
 * back to the default. `now` is injectable for testing; callers pass nothing in production.
 */
export function resolveWindow(
  params: { range?: string | string[]; from?: string | string[]; to?: string | string[] },
  now: Date = new Date(),
): ResolvedWindow {
  const raw = first(params.range);
  const key: RangeKey = (RANGE_OPTIONS.some((o) => o.key === raw) ? raw : DEFAULT_RANGE) as RangeKey;

  switch (key) {
    case "30d":
      return { key, start: new Date(now.getTime() - 30 * DAY), end: null, title: "Last 30 days", comparisonLabel: "vs 30d ago", reviewTitle: "Last 30 days in review" };
    case "90d":
      return { key, start: new Date(now.getTime() - 90 * DAY), end: null, title: "Last 90 days", comparisonLabel: "vs 90d ago", reviewTitle: "Last 90 days in review" };
    case "quarter":
      return { key, start: startOfQuarter(now), end: null, title: "This quarter", comparisonLabel: "vs quarter start", reviewTitle: "Quarter in review" };
    case "all":
      return { key, start: null, end: null, title: "All time", comparisonLabel: "", reviewTitle: "All-time review" };
    case "custom": {
      const from = first(params.from);
      const to = first(params.to);
      const start = parseDay(from);
      const toDay = parseDay(to);
      // Make `to` inclusive of its whole day; an absent `to` leaves the window open-ended (now).
      const end = toDay ? new Date(toDay.getTime() + DAY - 1) : null;
      return {
        key,
        start,
        end,
        title: "Custom range",
        comparisonLabel: start ? "vs range start" : "",
        reviewTitle: "Range in review",
        from: from ?? undefined,
        to: to ?? undefined,
      };
    }
  }
}
