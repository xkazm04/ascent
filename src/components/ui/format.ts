// Brand presentational formatters — shared across every branded surface (landing, report, org).
// Kept dependency-free and server-safe.

import { isWithinNoise } from "@/lib/maturity/noise";

/**
 * Color a score delta on the dark canvas: lime up · orange down · slate for flat OR within-noise.
 * A within-noise delta (|d| <= SCORE_NOISE_BAND) is muted to slate so a re-scan wobble never wears
 * the confident green/orange of a real move — see @/lib/maturity/noise.
 */
export const deltaHex = (d: number): string => (isWithinNoise(d) ? "#94a3b8" : d > 0 ? "#84cc16" : "#f97316");

/** "+8" / "-5" / "0" — signed delta for inline text. */
export const signedDelta = (d: number): string => `${d > 0 ? "+" : ""}${d}`;

/**
 * The single source of truth for the direction-tone triad — the rising/falling/flat →
 * {arrow, color, label} mapping used by every fleet "which way is it moving" surface (trajectory,
 * movers, portfolio). Lime up · orange down · slate flat, with ▲/▼/→. Keep this the only copy so a
 * glyph/color rebrand lands in one place instead of being hunted across hand-rolled literals.
 */
export const DIRECTION_TONE = {
  rising: { arrow: "▲", color: "#84cc16", label: "rising" },
  falling: { arrow: "▼", color: "#f97316", label: "falling" },
  flat: { arrow: "→", color: "#94a3b8", label: "holding" },
} as const;

/**
 * "▲+8" / "▼-5" / "≈+1" / "→0" — arrowed delta badge. Within-noise non-zero deltas use "≈" (held,
 * within the scan-to-scan noise band) instead of ▲/▼, so a small wobble is not shown as real movement.
 */
export function fmtDelta(d: number): string {
  const arrow = d === 0 ? "→" : isWithinNoise(d) ? "≈" : d > 0 ? "▲" : "▼";
  return `${arrow}${signedDelta(d)}`;
}
