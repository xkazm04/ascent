// ── THE CANONICAL ORG TIME-ZONE POLICY ──────────────────────────────────────────────────────────
//
// One reference frame for every calendar-day decision the org dashboard makes: window preset starts,
// custom-range parsing, trend day-keys, and due-date bucketing. Before this module each of those
// picked its own frame — presets and `parseDay` used the SERVER's local zone, `daysUntil` compared a
// UTC-truncated target against a locally-truncated `now`, and the usage chart keyed days in UTC. The
// same scan could therefore fall inside the window on one surface and outside it on another, and a
// backlog item could read "overdue" a day early. (G4-07)
//
// THE POLICY
//   1. There is exactly ONE canonical zone per deployment, returned by `orgTimeZone()`.
//   2. It defaults to **UTC**. Server-local was never a decision — it is whatever the host happened
//      to be set to (UTC on Vercel, CET on a European dev laptop), so the identical data produced
//      different day buckets in dev and prod and moved if the host's TZ was ever changed. UTC is
//      stable, reproducible, matches how date-only columns are already persisted (midnight UTC), and
//      matches the day-key axis `src/lib/db/usage.ts` already uses.
//   3. A deployment may override it with the `ASCENT_ORG_TZ` env var (any IANA name, e.g.
//      "America/New_York") — an org that lives in one place gets its own days with no schema change.
//   4. Every boundary is HALF-OPEN: `[start, endExclusive)`. Inclusive ends are how off-by-one-day
//      bugs breed. `ResolvedWindow.end` survives only as the last representable instant of the same
//      interval, for callers whose query builders still say `lte`.
//   5. A *date literal* (a `yyyy-mm-dd` a human picked, or a date-only DB column) is NOT an instant.
//      It is read back with `dayKeyOfDateColumn` (UTC getters, because that is how it was written)
//      and only then compared against `now`'s day in the canonical zone. Never truncate a date-only
//      column in a non-UTC zone — you get the previous day.
//
// KNOWN LIMIT / BLOCKER — per-org time zones
//   The most correct answer is a per-organization zone ("this org's Monday"), but that needs an
//   `Organization.timezone` column and migrations are out of scope here. Every function below already
//   takes an explicit `tz` argument with `orgTimeZone()` only as the default, so wiring a persisted
//   per-org value is a one-line change at each call site once the column exists. Until then the
//   deployment-wide default (UTC, or `ASCENT_ORG_TZ`) is the policy.
//
// Pure + isomorphic: no I/O, no next/headers — safe to import from `window.ts`, which the client-side
// TimeRangeSelector also imports. `process.env` is read lazily and defensively so a browser bundle
// (where the non-`NEXT_PUBLIC_` var is not inlined) simply falls back to UTC.

/** Milliseconds in a nominal day. Only safe for *instant* math — never for calendar-day arithmetic
 *  (a DST day is 23 or 25 hours). Use `addDaysInZone` when you mean "the next calendar day". */
export const DAY_MS = 86_400_000;

/** The policy default. Documented, deliberate, and deployment-independent. */
export const DEFAULT_ORG_TZ = "UTC";

let cachedTz: string | null = null;

/**
 * The canonical zone for all org calendar-day math. `ASCENT_ORG_TZ` when set to a zone this runtime
 * actually knows, else UTC. Cached — the value cannot change within a process.
 */
export function orgTimeZone(): string {
  if (cachedTz) return cachedTz;
  let tz = DEFAULT_ORG_TZ;
  try {
    const raw = typeof process !== "undefined" ? process.env?.ASCENT_ORG_TZ : undefined;
    if (raw && raw.trim()) {
      // Validate against the runtime rather than trusting the env: an unknown zone would otherwise
      // throw deep inside a dashboard render. A bad value degrades to UTC, it does not 500.
      const candidate = raw.trim();
      const probe = new Intl.DateTimeFormat("en-US", { timeZone: candidate });
      if (probe.resolvedOptions().timeZone) tz = candidate;
    }
  } catch {
    tz = DEFAULT_ORG_TZ;
  }
  cachedTz = tz;
  return tz;
}

/** Test-only: forget the memoized zone so a test can drive `ASCENT_ORG_TZ`. */
export function __resetOrgTimeZoneCache(): void {
  cachedTz = null;
  fmtCache.clear();
}

// Intl.DateTimeFormat construction is expensive and these run per-row on backlog/trend loops, so the
// formatter is built once per zone.
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

/** The wall-clock parts of instant `d` as seen in `tz`. */
export function partsInZone(d: Date, tz: string = orgTimeZone()): ZonedParts {
  const p = partsFormatter(tz).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? "0");
  // `hourCycle: h23` is implied by hour12:false, but some runtimes still emit "24" for midnight.
  const hour = get("hour") % 24;
  return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute"), second: get("second") };
}

/** How far `tz`'s wall clock is ahead of UTC at instant `d`, in ms (negative west of Greenwich). */
function zoneOffsetMs(d: Date, tz: string): number {
  const p = partsInZone(d, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Drop sub-second noise: the formatter has second resolution, the instant may not.
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `tz` reads exactly `year-month-day 00:00:00`.
 * Two passes: guess with the offset at the UTC-interpreted instant, then correct with the offset that
 * actually applies at the guess (this is what makes it right across a DST transition). On a
 * spring-forward day where local midnight does not exist, this lands on the first instant that does.
 */
export function zonedMidnight(year: number, month: number, day: number, tz: string = orgTimeZone()): Date {
  const naive = Date.UTC(year, month - 1, day);
  let ts = naive - zoneOffsetMs(new Date(naive), tz);
  ts = naive - zoneOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

/** Start of the calendar day containing `d`, in `tz`. The canonical replacement for `startOfDay`. */
export function startOfDayInZone(d: Date, tz: string = orgTimeZone()): Date {
  const p = partsInZone(d, tz);
  return zonedMidnight(p.year, p.month, p.day, tz);
}

/** Calendar-day arithmetic in `tz` (DST-safe — never a flat `n * DAY_MS`). Returns a zoned midnight. */
export function addDaysInZone(d: Date, days: number, tz: string = orgTimeZone()): Date {
  const p = partsInZone(d, tz);
  return zonedMidnight(p.year, p.month, p.day + days, tz);
}

/** Start of the calendar quarter containing `d`, in `tz`. */
export function startOfQuarterInZone(d: Date, tz: string = orgTimeZone()): Date {
  const p = partsInZone(d, tz);
  return zonedMidnight(p.year, Math.floor((p.month - 1) / 3) * 3 + 1, 1, tz);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `yyyy-mm-dd` of the calendar day containing `d`, in `tz`. The canonical day key. */
export function dayKeyInZone(d: Date, tz: string = orgTimeZone()): string {
  const p = partsInZone(d, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Read back a DATE-ONLY database column (or any value written as midnight UTC) as the literal
 * calendar day a human picked. Always UTC getters — that is the frame it was WRITTEN in, and
 * re-truncating it in a westward zone would silently yield the previous day. See policy note 5.
 */
export function dayKeyOfDateColumn(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Parse a `yyyy-mm-dd` literal into its zoned-midnight instant; null when blank or malformed. */
export function parseDayKey(s: string | undefined | null, tz: string = orgTimeZone()): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = zonedMidnight(year, month, day, tz);
  if (Number.isNaN(d.getTime())) return null;
  // Reject overflow dates (2026-02-31 → Mar 3) so a typo'd bound never silently shifts the window.
  const back = partsInZone(d, tz);
  return back.year === year && back.month === month && back.day === day ? d : null;
}

/**
 * Whole calendar days from day key `fromKey` to day key `toKey` (negative when `toKey` is earlier).
 * Both are literal `yyyy-mm-dd` strings, so this is exact integer arithmetic with no zone or DST
 * involvement — the zone choice happens when the keys are derived, not here.
 */
export function daysBetweenDayKeys(fromKey: string, toKey: string): number {
  const at = (k: string) => {
    const p = k.split("-");
    return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  };
  return Math.round((at(toKey) - at(fromKey)) / DAY_MS);
}
