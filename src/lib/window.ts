// Time-range windows for the org dashboard. A window does double duty: it bounds the trend /
// movers to a period, AND it fixes the *baseline date* for period-over-period deltas — the
// fleet snapshot the present is compared against ("AI Adoption 62 ▲+8 vs last quarter").
//
// Pure + isomorphic: safe to import in server components (the date math) and in the client
// selector (which only needs RANGE_OPTIONS / DEFAULT_RANGE).
//
// TIME ZONE: every boundary below is computed in the CANONICAL ORG ZONE (`src/lib/org/timezone.ts`,
// UTC by default, `ASCENT_ORG_TZ`-overridable) — never in the server's local zone, which was only ever
// whatever the host happened to be set to. Read that module's header for the full policy; it is the
// single place the decision lives. Day arithmetic here is CALENDAR arithmetic (`addDaysInZone`), not
// `n × 86.4M ms`, so a lookback that straddles a DST transition still lands on a clean day boundary.
//
// INTERVALS ARE HALF-OPEN: a window means `[start, endExclusive)`. That is the ONE closure convention
// this value carries. The inclusive last instant is no longer arithmetic each consumer re-derives —
// it is produced by exactly one adapter, `inclusiveEnd()` below, at the edge that needs it. (G4-07)

import { addDaysInZone, dayKeyInZone, parseDayKey, startOfQuarterInZone } from "@/lib/org/timezone";

export type RangeKey = "30d" | "90d" | "quarter" | "all" | "custom";

/**
 * A bound that closes an interval INCLUSIVELY (`lte`) — the foreign convention. The alias exists so
 * the deprecated `ResolvedWindow.end` is marked at the TYPE level, not only in prose: a reader (and a
 * `grep`) can see which values in this codebase still speak the inclusive dialect, and the alias is
 * the marker that has to disappear when the last `lte` call site migrates. Values of this type must
 * only ever be produced by {@link inclusiveEnd}.
 */
export type InclusiveEndBound = Date | null;

/**
 * THE edge adapter between the half-open window and a query builder that can only say `lte`.
 *
 * Interval closure is converted in exactly ONE place, here, at the boundary that needs it — it used
 * to be an `endExclusive − 1ms` alias riding inside the window value, so every consumer holding a
 * window held two bounds in two conventions and picked whichever its query builder happened to want.
 * Two surfaces reading the SAME window could then disagree about a boundary row.
 *
 * The 1ms is a real precision hazard, and that is precisely why it is confined here: the store keeps
 * timestamps at MICROSECOND resolution, so a row stamped inside the final millisecond of a window is
 * matched by `lt: endExclusive` and missed by `lte: inclusiveEnd(...)`. The trade-off accepted is a
 * bounded, documented, single-site inaccuracy for callers that cannot express `lt` — never a second
 * closure convention stored on the value. Prefer `lt: endExclusive`; reach for this only at a `lte`
 * edge, and only until that edge migrates. (G4-07)
 */
export function inclusiveEnd(endExclusive: Date | null): InclusiveEndBound {
  return endExclusive ? new Date(endExclusive.getTime() - 1) : null;
}

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
  /**
   * @deprecated COMPAT ONLY — the inclusive dialect, kept while the remaining `lte` call sites move.
   * It is `inclusiveEnd(endExclusive)` and nothing else; do not re-derive it, do not add consumers.
   * New code takes `endExclusive` with `lt`, or calls {@link inclusiveEnd} at its own `lte` edge
   * ({@link orgWindowBounds} in `src/lib/org/period.ts` is the half-open shape to hand the db layer).
   * The field disappears when the last `lte` consumer migrates; the type alias marks who is left.
   */
  end: InclusiveEndBound;
  /**
   * The canonical HALF-OPEN upper bound: the window is `[start, endExclusive)`. For a custom range
   * this is the zoned midnight STARTING the day after `to`. null = open-ended.
   */
  endExclusive: Date | null;
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

/** First day of the calendar quarter containing `now`, at canonical-zone midnight. */
const startOfQuarter = (now: Date): Date => startOfQuarterInZone(now);

/** Parse a yyyy-mm-dd input into a canonical-zone midnight Date, or null when blank/invalid. */
const parseDay = (s: string | undefined): Date | null => parseDayKey(s);

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Format a Date as the canonical-zone `yyyy-mm-dd` the custom-range inputs use (round-trips parseDay). */
const toDayInput = (d: Date): string => dayKeyInZone(d);

/**
 * The trailing-week window as `?range=custom&from=&to=` params, snapped to CANONICAL-ZONE CALENDAR DAYS so it
 * shares the dashboard's boundary semantics instead of a raw rolling 168h offset. `from` is 6 days
 * before today (inclusive) and `to` is today, i.e. a 7-day inclusive span. Feeding these through
 * resolveWindow (or the executive URL) makes a "this week" push and the page it links to agree on the
 * exact same period boundaries. (fleet-alerts-digests #5)
 */
export function weekRangeParams(now: Date = new Date()): { range: "custom"; from: string; to: string } {
  return { range: "custom", from: toDayInput(addDaysInZone(now, -6)), to: toDayInput(now) };
}

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
    // Rolling-window starts are CANONICAL-ZONE MIDNIGHT of the day N calendar days back (like
    // quarter/custom), not a raw N×86.4M-ms offset from "right now". A bare offset made the baseline
    // an arbitrary wall-clock instant (14:37…) that flickered within a calendar day, so a boundary-day
    // scan landed on the wrong side of `start` depending on the hour the page rendered. `addDaysInZone`
    // additionally closes the DST seam the old `startOfDay(now − N×DAY)` still had: subtracting a flat
    // 90 nominal days across a spring-forward transition could snap to the adjacent calendar day
    // depending on the render hour. It is now exactly "N calendar days back", always. (G4-07)
    case "30d":
      return { key, start: addDaysInZone(now, -30), end: null, endExclusive: null, title: "Last 30 days", comparisonLabel: "vs 30d ago", reviewTitle: "Last 30 days in review" };
    case "90d":
      return { key, start: addDaysInZone(now, -90), end: null, endExclusive: null, title: "Last 90 days", comparisonLabel: "vs 90d ago", reviewTitle: "Last 90 days in review" };
    case "quarter":
      return { key, start: startOfQuarter(now), end: null, endExclusive: null, title: "This quarter", comparisonLabel: "vs quarter start", reviewTitle: "Quarter in review" };
    case "all":
      return { key, start: null, end: null, endExclusive: null, title: "All time", comparisonLabel: "", reviewTitle: "All-time review" };
    case "custom": {
      let from = first(params.from);
      let to = first(params.to);
      let start = parseDay(from);
      let toDay = parseDay(to);
      // Guard a reversed range: when BOTH bounds parse and from > to, swap them rather than yielding
      // start > end — which downstream matches no rows (blank trend/forecast) while the baseline query
      // (lt: start) still returns an incoherent, end-bounded "current" snapshot that predates start.
      // Swapping keeps the user's two dates and presents a coherent period instead of empty data. (fleet-rollups-insights #5)
      if (start && toDay && start.getTime() > toDay.getTime()) {
        [start, toDay] = [toDay, start];
        [from, to] = [to, from];
      }
      // `to` names a whole calendar day, so the half-open upper bound is the START of the NEXT day in
      // the canonical zone (calendar arithmetic, so a DST day is still one whole day). The inclusive
      // compat bound goes through the one adapter — the subtraction is not repeated here. An absent
      // `to` leaves both null (open to now).
      const endExclusive = toDay ? addDaysInZone(toDay, 1) : null;
      const end = inclusiveEnd(endExclusive);
      // Echo the RESOLVED bounds in the title. Custom is the one period whose parameters aren't
      // implied by its name: a shared ?range=custom link, a remembered cookie, or the silent
      // reversed-range swap above would otherwise render "Custom range" while every number on the
      // page depends on dates the reader can't see. The post-swap from/to keeps the title honest.
      const title = start ? `${from} → ${to ?? "now"}` : "Custom range";
      return {
        key,
        start,
        end,
        endExclusive,
        title,
        comparisonLabel: start ? "vs range start" : "",
        reviewTitle: start ? `${title} in review` : "Range in review",
        from: from ?? undefined,
        to: to ?? undefined,
      };
    }
  }
}
