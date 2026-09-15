// The scene's ONE formatter module behind its display primitives (number-formatting +
// timestamp-display). Every function takes the locale as its LAST argument because the primitives in
// primitives.tsx bind it from the scene's locale context — no call site of `<Num>` or `<Elapsed>`
// passes a locale, so none can forget one. Formatter construction is cached at module scope, keyed by
// locale + the option fields actually varied: a call site never constructs its own. No React.

import type { Locale } from "./vocabulary";

// ── Numbers ──────────────────────────────────────────────────────────────────────────────────────
export type Unit = "usd" | "percent" | "compact" | "count";

const NUMBER_OPTIONS: Record<Unit, Intl.NumberFormatOptions> = {
  // Per-quantity precision ladders live HERE, once. Money: two decimals; the sub-unit guard below
  // keeps a real sub-cent spend from rendering as a confident zero.
  usd: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 },
  percent: { style: "percent", maximumFractionDigits: 1 },
  // Compact is a different numbering system per locale (lakh, 万) — never a suffix concatenated on.
  compact: { notation: "compact", maximumFractionDigits: 1 },
  count: { maximumFractionDigits: 0 },
};

const numberCache = new Map<string, Intl.NumberFormat>();
export function numberFormatter(unit: Unit, locale: Locale): Intl.NumberFormat {
  const key = `${locale}|${unit}`;
  let f = numberCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, NUMBER_OPTIONS[unit]);
    numberCache.set(key, f);
  }
  return f;
}

/** The smallest money figure the display precision can state; below it the guard notation applies. */
export const MONEY_FLOOR = 0.01;
/** The placeholder for an ABSENT value — uniform across every unit and precision. */
export const ABSENT = "—";

/**
 * Zero, unknown and too-small are three facts: null → the placeholder; exact zero → zero (never the
 * "less than" notation — "free" and "unmeasurably small" are different claims); a money figure whose
 * magnitude is below the floor → "<" + the floor, with the sign placed by the locale layer.
 */
export function fmtNumber(value: number | null | undefined, unit: Unit, locale: Locale): string {
  if (value == null || !Number.isFinite(value)) return ABSENT;
  const f = numberFormatter(unit, locale);
  if (unit === "usd" && value !== 0 && Math.abs(value) < MONEY_FLOOR) return `<${f.format(Math.sign(value) * MONEY_FLOOR)}`;
  return f.format(value);
}

/** The counter-example the scene puts beside the primitive: glyph concatenated to a fixed render. */
export const handRolledMoney = (value: number | null): string => (value == null ? "$0.00" : `$${value.toFixed(2)}`);

// ── Moments ──────────────────────────────────────────────────────────────────────────────────────
/** The fixed-moment primitive's closed set of named shapes — a dense table and a drawer agree. */
export type MomentVariant = "compact" | "time" | "full";
const MOMENT_OPTIONS: Record<MomentVariant, Intl.DateTimeFormatOptions> = {
  compact: { month: "short", day: "numeric" },
  time: { hour: "numeric", minute: "2-digit" },
  full: { dateStyle: "medium", timeStyle: "short" },
};

const momentCache = new Map<string, Intl.DateTimeFormat>();
export function fmtMoment(instant: number, variant: MomentVariant, locale: Locale): string {
  const key = `${locale}|${variant}`;
  let f = momentCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, MOMENT_OPTIONS[variant]);
    momentCache.set(key, f);
  }
  return f.format(instant);
}

const relativeCache = new Map<Locale, Intl.RelativeTimeFormat>();
function relativeFormatter(locale: Locale): Intl.RelativeTimeFormat {
  let f = relativeCache.get(locale);
  if (!f) {
    // The elapsed vocabulary comes from the platform: plural rules, word order and "yesterday" in
    // every locale for zero catalog keys. No ladder of strings is authored here.
    f = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeCache.set(locale, f);
  }
  return f;
}

/** Small skew (a resumed laptop, NTP drift) is clamped to "now"; beyond this, relative rendering is abandoned. */
export const FUTURE_SKEW_TOLERANCE_MS = 2 * 60_000;

const RUNGS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400_000], ["month", 30 * 86_400_000], ["day", 86_400_000], ["hour", 3_600_000], ["minute", 60_000], ["second", 1000],
];

/**
 * The elapsed label, or `null` when the instant lies in the future beyond tolerance — the caller must
 * then show the absolute moment and report the skew, because an impossible value must not render as
 * the calmest one ("just now").
 */
export function fmtElapsed(instant: number, now: number, locale: Locale): string | null {
  let diff = instant - now;
  if (diff > FUTURE_SKEW_TOLERANCE_MS) return null;
  if (diff > 0) diff = 0; // clamp small skew to "now"
  for (const [unit, ms] of RUNGS) {
    if (Math.abs(diff) >= ms) return relativeFormatter(locale).format(Math.round(diff / ms), unit);
  }
  return relativeFormatter(locale).format(0, "second");
}

// One skew breadcrumb per instant per session — the only layer that ever sees the upstream data bug.
const skewReported = new Set<number>();
const skewListeners = new Set<() => void>();
export function reportSkew(instant: number): void {
  if (skewReported.has(instant)) return;
  skewReported.add(instant);
  skewListeners.forEach((l) => l());
}
export const skewReports = (): number => skewReported.size;
export function onSkew(l: () => void): () => void {
  skewListeners.add(l);
  return () => void skewListeners.delete(l);
}
