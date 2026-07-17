// Brand presentational formatters — shared across every branded surface (landing, report, org).
// Kept dependency-free and server-safe.

import { isWithinNoise } from "@/lib/maturity/noise";

/**
 * Color a score delta on the dark canvas: lime up · orange down · slate for flat OR within-noise.
 * A within-noise delta (|d| <= SCORE_NOISE_BAND) is muted to slate so a re-scan wobble never wears
 * the confident green/orange of a real move — see @/lib/maturity/noise.
 */
export const deltaHex = (d: number): string => DIRECTION_TONE[toneFor(d)].color;

/** "+8" / "-5" / "0" — signed delta for inline text. */
export const signedDelta = (d: number): string => `${d > 0 ? "+" : ""}${d}`;

/**
 * The single source of truth for the direction-tone triad — the rising/falling/flat →
 * {arrow, color, label} mapping used by every fleet "which way is it moving" surface (trajectory,
 * movers, portfolio). Lime up · orange down · slate flat, with ▲/▼/→. Keep this the only copy so a
 * glyph/color rebrand lands in one place instead of being hunted across hand-rolled literals.
 *
 * The hexes are PAIRED with the CSS tokens `--color-tone-rising/-falling/-flat` in
 * src/app/globals.css (same BRAND_INK-style pairing as lib/site.ts): TS keeps literals because these
 * values feed inline styles and tests, where a `var()` string can't be resolved. Change BOTH together.
 */
export const DIRECTION_TONE = {
  rising: { arrow: "▲", color: "#84cc16", label: "rising" },
  falling: { arrow: "▼", color: "#f97316", label: "falling" },
  flat: { arrow: "→", color: "#94a3b8", label: "holding" },
} as const;

/**
 * Classify a numeric delta into a direction-tone key. A within-noise non-zero delta
 * (|d| <= SCORE_NOISE_BAND) maps to "flat" so it never wears the confident rising/falling tone of a
 * real move — matching the noise mute that `deltaHex`/`fmtDelta` already enforce.
 */
export function toneFor(delta: number): keyof typeof DIRECTION_TONE {
  return isWithinNoise(delta) ? "flat" : delta > 0 ? "rising" : "falling";
}

/**
 * "▲+8" / "▼-5" / "≈+1" / "→0" — arrowed delta badge. Within-noise non-zero deltas use "≈" (held,
 * within the scan-to-scan noise band) instead of ▲/▼, so a small wobble is not shown as real movement.
 */
export function fmtDelta(d: number): string {
  const arrow = d === 0 ? "→" : isWithinNoise(d) ? "≈" : d > 0 ? "▲" : "▼";
  return `${arrow}${signedDelta(d)}`;
}

/**
 * "Jun 9" — short month + day, PINNED to en-US ({month:"short", day:"numeric"}). The single source
 * for the compact date used across the report (trend-axis labels, quota reset/stale dates), which
 * was hand-inlined at several call sites.
 *
 * Deliberately not the viewer's locale: the call sites are "use client" components that Next.js
 * still prerenders on the SERVER, where `undefined` resolves to the server's ICU locale — a viewer
 * with a different browser locale then hydrates "Jun 9" into "9 juin" (hydration mismatch + a date
 * that flickers between formats). en-US matches the brand's mono/editorial voice everywhere else.
 */
export function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Guarded short date from an ISO string / epoch ms: parses the input and returns "" for an
 * invalid/unparseable value (the trend-chart axis and the quota stale-notice both need invalid → "").
 */
export function shortDateSafe(value: string | number): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : shortDate(d);
}
