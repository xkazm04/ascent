// Numeric guards shared by the /org viz kit.
//
// Every chart here takes plain data straight off an API row, and a NaN/Infinity that reaches a path
// `d`, an SVG geometry attribute or a `style.width` produces a silently broken graphic rather than a
// visible error — the exact failure `vScale` (chartScale.ts) and `Meter` (uiMeters.tsx) already
// guard against. These are the same guard, factored for the kit.

/** A finite number or `fallback` (default 0). The single NaN/Infinity gate before any geometry. */
export function finite(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** True only for a real, finite number — use it to DROP a mark rather than plot a fallback. */
export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Clamp into `[lo, hi]` with the same NaN guard; a non-finite input collapses to `lo`. */
export function clamp(v: unknown, lo: number, hi: number): number {
  const n = finite(v, lo);
  return Math.max(lo, Math.min(hi, n));
}

/** `part / whole` as a 0..100 percentage, guarded: a zero or non-finite whole yields 0, never NaN. */
export function pct(part: unknown, whole: unknown): number {
  const w = finite(whole, 0);
  if (w <= 0) return 0;
  return clamp((finite(part, 0) / w) * 100, 0, 100);
}

/**
 * Format a number for a `tabular-nums` readout (BRAND.md: numbers are typeset). Integers print bare;
 * everything else rounds to `digits` (default 1) with trailing zeros trimmed. A non-finite input
 * prints an em dash — the honest glyph for "no measurement", which is exactly why no chart in this
 * kit ever prints a `0` for a `missing` state.
 */
export function fmtNum(v: unknown, digits = 1): string {
  if (!isNum(v)) return "—";
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toFixed(digits)));
}

/** Round an SVG coordinate to 2dp — the server/client ULP guard from `report/svgCoord`. */
export { r2 } from "@/components/report/svgCoord";
