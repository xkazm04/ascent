// Shared UI helpers — color mapping for levels/scores and small formatting utilities.
// Pure functions, safe to import in both server and client components.

import type { DimensionId, LevelId } from "@/lib/types";
import { levelForScore } from "@/lib/maturity/model";

/** Short labels for tight UI (radar axes, chips). */
export const DIMENSION_SHORT: Record<DimensionId, string> = {
  D1: "AI Tooling",
  D2: "Testing",
  D3: "CI/CD",
  D4: "Agentic",
  D5: "Docs",
  D6: "Quality",
  D7: "Commits",
  D8: "AI Process",
  D9: "Security",
};

/**
 * Brand hex per maturity level (red -> green as you ascend).
 *
 * WCAG audit (accessibility pass): used as FOREGROUND numerals/labels on the app's dark canvas
 * (body #080d1a, cards over slate-950 #020617), every token clears AA for normal text (≥4.5:1).
 * The floor is L1 red #ef4444 at ~5.2:1; L2–L5 sit at ~7–10:1 (yellow/lime are the brightest,
 * not the weakest, on a dark background). Darkening any token here would REDUCE contrast, so the
 * ramp is kept as-is — and hue is never the sole signal: pair it with LEVEL_GLYPH and the
 * always-present L1–L5 id. (As a solid FILL behind white text — e.g. the README badge — the
 * lighter tokens fail; that surface is out of scope for this numeral-contrast pass.)
 */
export const LEVEL_HEX: Record<LevelId, string> = {
  L1: "#ef4444",
  L2: "#f97316",
  L3: "#eab308",
  L4: "#84cc16",
  L5: "#22c55e",
};

/**
 * Non-color redundant encoding per level: a circle that fills as maturity ascends
 * (L1 empty → L5 solid). The red→green LEVEL_HEX ramp collapses for the ~8% of men with
 * red-green color vision deficiency, so anywhere hue signals a level/score, render this glyph
 * (and/or the L1–L5 id) alongside it. The glyphs are decorative reinforcement of adjacent text,
 * so mark them aria-hidden — the level id / numeric score carries the meaning for screen readers.
 */
export const LEVEL_GLYPH: Record<LevelId, string> = {
  L1: "○", // U+25CB  empty
  L2: "◔", // U+25D4  one-quarter
  L3: "◑", // U+25D1  half
  L4: "◕", // U+25D5  three-quarter
  L5: "●", // U+25CF  full
};

/** Glyph for a 0..100 score, routed through the rubric like scoreHex (score → level → glyph). */
export function scoreGlyph(score: number): string {
  return LEVEL_GLYPH[levelForScore(score).id];
}

/** Tailwind text/border/bg class triplets per level, for consistent theming. */
export const LEVEL_CLASSES: Record<LevelId, { text: string; border: string; bg: string }> = {
  L1: { text: "text-red-400", border: "border-red-500/40", bg: "bg-red-500/10" },
  L2: { text: "text-orange-400", border: "border-orange-500/40", bg: "bg-orange-500/10" },
  L3: { text: "text-yellow-400", border: "border-yellow-500/40", bg: "bg-yellow-500/10" },
  L4: { text: "text-lime-400", border: "border-lime-500/40", bg: "bg-lime-500/10" },
  L5: { text: "text-emerald-400", border: "border-emerald-500/40", bg: "bg-emerald-500/10" },
};

/**
 * Map a 0..100 score to its brand hex by routing through the canonical rubric:
 * the score's maturity level (LEVELS bands in model.ts) selects the color. This keeps
 * the color ramp and the displayed level in lockstep — retuning a level band in the
 * rubric automatically retunes the colors, so the two can never silently desync.
 */
export function scoreHex(score: number): string {
  return LEVEL_HEX[levelForScore(score).id];
}

export const IMPACT_CLASS: Record<string, string> = {
  high: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  medium: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  low: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export const EFFORT_CLASS: Record<string, string> = {
  low: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  medium: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  high: "bg-red-500/15 text-red-300 border-red-500/30",
};

export function timeAgo(iso?: string): string {
  if (!iso) return "unknown";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "unknown";
  const days = Math.floor((Date.now() - d) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * Fine-grained "time since" for scan freshness ("just now", "4m ago", "2h ago") — unlike
 * timeAgo (day-granularity, for repo pushedAt), this resolves seconds→minutes→hours so a
 * just-completed scan reads honestly. Falls through to timeAgo's day/month/year bands for older
 * scans. Drives the report's "scanned 4m ago — re-test" control, re-evaluated on a live ticker.
 */
export function freshness(iso?: string): string {
  if (!iso) return "unknown";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return timeAgo(iso);
}
