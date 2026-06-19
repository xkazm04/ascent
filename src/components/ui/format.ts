// Brand presentational formatters — shared across every branded surface (landing, report, org).
// Kept dependency-free and server-safe.

/** Color a positive / negative / flat delta on the dark canvas (lime up · orange down · slate flat). */
export const deltaHex = (d: number): string => (d > 0 ? "#84cc16" : d < 0 ? "#f97316" : "#94a3b8");

/** "+8" / "-5" / "0" — signed delta for inline text. */
export const signedDelta = (d: number): string => `${d > 0 ? "+" : ""}${d}`;

/** "▲+8" / "▼-5" / "→0" — signed, arrowed delta badge. */
export function fmtDelta(d: number): string {
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "→";
  return `${arrow}${signedDelta(d)}`;
}
