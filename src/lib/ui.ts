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

/** Stable permalink to a repo's report, pinned to a commit when one is known
 *  (`/report/{owner}/{repo}` or `/report/{owner}/{repo}@{sha}`). Lives in this client-safe
 *  module so both server callers and the client trend charts build the identical link
 *  (re-exported from @/lib/db/scans for the existing db-barrel importers). */
export function reportPermalink(fullName: string, headSha?: string | null): string {
  return `/report/${fullName}${headSha ? `@${headSha}` : ""}`;
}

/** External jump to the exact commit a scan pinned to — the "what landed?" half of the trend
 *  investigation loop (reportPermalink is the in-app half). Client-safe sibling so every chart
 *  builds the identical URL. Null without a sha. */
export function githubCommitUrl(fullName: string, headSha?: string | null): string | null {
  return headSha ? `https://github.com/${fullName}/commit/${headSha}` : null;
}

/** The per-installation Configure page on GitHub — where repository access is actually granted
 *  (GitHub redirects org-owned installations to the org-scoped settings path). Use this, not the
 *  generic install page (appInstallUrl), whenever the installation id is known: "I don't see my
 *  repo" is the most common onboarding dead-end and this is the screen that fixes it. Lives in
 *  this client-safe module (no env read) so the connect client components can build it; re-exported
 *  from @/lib/github/app for server callers. */
export function appConfigureUrl(installationId: string | number): string {
  return `https://github.com/settings/installations/${installationId}`;
}

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

/**
 * Tailwind text/border/bg class triplets per level. The `text` shade is locked to the SAME stop and
 * hue as LEVEL_HEX above (the canonical red→green ramp the rings/charts/heatmap/badge all use), so a
 * level pill and the score ring beside it render ONE colour, not two. The text was previously -400
 * while LEVEL_HEX is -500, and L5 was `emerald` while LEVEL_HEX.L5 is `green` (#22c55e) — the same
 * level showed up as two different greens side by side. Keep this in lockstep with LEVEL_HEX.
 */
export const LEVEL_CLASSES: Record<LevelId, { text: string; border: string; bg: string }> = {
  L1: { text: "text-red-500", border: "border-red-500/40", bg: "bg-red-500/10" },
  L2: { text: "text-orange-500", border: "border-orange-500/40", bg: "bg-orange-500/10" },
  L3: { text: "text-yellow-500", border: "border-yellow-500/40", bg: "bg-yellow-500/10" },
  L4: { text: "text-lime-500", border: "border-lime-500/40", bg: "bg-lime-500/10" },
  L5: { text: "text-green-500", border: "border-green-500/40", bg: "bg-green-500/10" },
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

/** Parse #rrggbb / #rgb → [r, g, b] (0..255). */
function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}

/** WCAG relative luminance of an [r, g, b] triple. */
function relLuminance([r, g, b]: [number, number, number]): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/**
 * Heatmap cell styling for a 0..100 score rendered at a given intensity `alpha`. The intensity is
 * carried by the FILL's alpha (an rgba), NOT the element's `opacity` — putting opacity on the cell
 * also faded the numeral, which made low-score cells (the weaknesses users look for) unreadable. The
 * numeral color is then contrast-picked against the cell's effective color over the dark canvas, so
 * faint low-score cells get light text and bright high-score cells get dark ink.
 */
export function heatCell(score: number, alpha: number): { fill: string; text: string } {
  const fg = rgbOf(LEVEL_HEX[levelForScore(score).id]);
  const bg: [number, number, number] = [11, 19, 34]; // #0b1322 — the dark canvas behind the cell
  const eff: [number, number, number] = [
    Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
    Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
    Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
  ];
  const le = relLuminance(eff);
  // Compare white (~0.75 luminance) vs near-black ink against the effective cell color; higher wins.
  const contrastLight = 0.8 / (le + 0.05);
  const contrastInk = (le + 0.05) / 0.05;
  const text = contrastInk >= contrastLight ? "#04070e" : "#e2e8f0";
  return { fill: `rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, ${alpha})`, text };
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
