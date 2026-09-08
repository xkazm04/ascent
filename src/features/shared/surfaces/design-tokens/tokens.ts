// The scene's token AUTHORITY: one home for every closed vocabulary the appearance panel rebinds
// (token-taxonomy, theme-architecture, density-and-scale-axes). No React. Every custom property the
// preview consumes is GENERATED from this file by `scopeVars()` (cross-language-token-parity,
// strategy 1: one source, generated mirror), so the script-layer consumers (the chart's row height)
// and the style-layer consumers (`var(--sx-…)`) can never disagree.
//
// The values are fixture data for a FICTIONAL org theme, prefixed `--sx-` so nothing here collides
// with globals.css. The scene's own chrome stays on Ascent's brand classes; these hexes are the
// subject being shown, not styling the scene borrowed.

import { relLuminance, rgbOf } from "@/lib/ui";

// ── Layer 1: raw scales. Ordered ramps with no meaning; components never consume them. ──────────
export const PRIMITIVES = {
  slate: { 50: "#f8fafc", 200: "#e2e8f0", 400: "#94a3b8", 500: "#64748b", 700: "#334155", 800: "#1e293b", 900: "#0f172a", 950: "#080d1a" },
  azure: { 500: "#3b9eff", 700: "#1d6fd1" },
  red: { 500: "#ef4444", 600: "#dc2626" },
  white: "#ffffff",
} as const;

// ── Layer 2: semantic roles, `<axis>-<role>[-<variant>]`. What components consume, what themes rebind.
export const COLOR_ROLES = ["surface", "surface-raised", "foreground", "foreground-muted", "border", "accent", "on-accent", "danger"] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

/** One sentence per role: the owner-answerable definition a token needs to earn its name. */
export const ROLE_DEFINITION: Record<ColorRole, string> = {
  surface: "the panel a component sits on",
  "surface-raised": "a panel lifted above the surface (a card on a card)",
  foreground: "primary text on any surface",
  "foreground-muted": "secondary text: metadata, footnotes",
  border: "the hairline between regions",
  accent: "the one interactive emphasis",
  "on-accent": "text drawn on an accent fill",
  danger: "a destructive or failing state",
};

export type ThemeId = "light" | "dark";
export type Preference = ThemeId | "system";

/** A theme is a COMPLETE binding set and nothing else: every role, bound, per theme. */
export const THEMES: Record<ThemeId, Record<ColorRole, string>> = {
  dark: {
    surface: PRIMITIVES.slate[900],
    "surface-raised": PRIMITIVES.slate[800],
    foreground: PRIMITIVES.slate[50],
    "foreground-muted": PRIMITIVES.slate[400],
    border: PRIMITIVES.slate[700],
    accent: PRIMITIVES.azure[500],
    "on-accent": PRIMITIVES.slate[950],
    danger: PRIMITIVES.red[500],
  },
  light: {
    surface: PRIMITIVES.white,
    "surface-raised": PRIMITIVES.slate[50],
    foreground: PRIMITIVES.slate[950],
    "foreground-muted": PRIMITIVES.slate[500],
    border: PRIMITIVES.slate[200],
    accent: PRIMITIVES.azure[700],
    "on-accent": PRIMITIVES.white,
    danger: PRIMITIVES.red[600],
  },
};

/** The three-state model: an explicit choice wins in both directions; `system` follows the platform. */
export function resolveTheme(pref: Preference, platform: ThemeId): ThemeId {
  return pref === "system" ? platform : pref;
}

/** WCAG contrast of a foreground role against a surface role, from Ascent's own luminance math. */
export function contrastRatio(fg: string, bg: string): number {
  const a = relLuminance(rgbOf(fg));
  const b = relLuminance(rgbOf(bg));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
export const CONTRAST_FLOOR = 4.5;

/** Text pairs whose contrast is part of the token contract, checked per theme by `completeness()`. */
export const CONTRAST_PAIRS: readonly [ColorRole, ColorRole][] = [
  ["foreground", "surface"],
  ["foreground-muted", "surface"],
  ["on-accent", "accent"],
];

export type CompletenessRow = { theme: ThemeId; role: ColorRole; bound: boolean; contrast: number | null };

/**
 * The completeness gate: every role bound in every theme, and every contract pair above the floor.
 * `dropped` simulates the characteristic defect, a role defined in only one theme's block.
 */
export function completeness(dropped: { theme: ThemeId; role: ColorRole } | null): CompletenessRow[] {
  const rows: CompletenessRow[] = [];
  for (const theme of ["light", "dark"] as const) {
    for (const role of COLOR_ROLES) {
      const bound = !(dropped && dropped.theme === theme && dropped.role === role);
      const pair = CONTRAST_PAIRS.find(([fg]) => fg === role);
      const contrast = bound && pair ? contrastRatio(THEMES[theme][role], THEMES[theme][pair[1]]) : null;
      rows.push({ theme, role, bound, contrast });
    }
  }
  return rows;
}

// ── The user axes: each rebinds a DISJOINT slice of the vocabulary. ──────────────────────────────
export type Density = "comfortable" | "compact";
export const SPACE_ROLES = ["space-card", "space-row", "row-h"] as const;
export type SpaceRole = (typeof SPACE_ROLES)[number];
/** Density rebinds spacing and row height in px. It never touches a type size. */
export const DENSITY: Record<Density, Record<SpaceRole, number>> = {
  comfortable: { "space-card": 16, "space-row": 10, "row-h": 36 },
  compact: { "space-card": 10, "space-row": 4, "row-h": 24 },
};

export type TextScale = 1 | 1.15 | 1.3;
export const TEXT_SCALES: readonly TextScale[] = [1, 1.15, 1.3];
export const TYPE_ROLES = ["type-caption", "type-body", "type-figure"] as const;
export type TypeRole = (typeof TYPE_ROLES)[number];
/** Type recipes at scale 1, in px; text scale multiplies them and nothing else. */
export const TYPE_BASE_PX: Record<TypeRole, number> = { "type-caption": 13, "type-body": 15, "type-figure": 25 };

export const AXIS_OWNERSHIP = {
  theme: COLOR_ROLES,
  density: SPACE_ROLES,
  "text-scale": TYPE_ROLES,
} as const;
export type AxisId = keyof typeof AXIS_OWNERSHIP;

export type ScopeState = {
  theme: ThemeId;
  density: Density;
  scale: TextScale;
  /** The role deliberately left unbound in one theme, or null. */
  dropped: { theme: ThemeId; role: ColorRole } | null;
};

/**
 * The generated mirror: the custom properties stamped on the scope root. A dropped role is simply
 * absent, so `var(--sx-<role>)` in the preview resolves to nothing and the declaration falls back
 * to the inherited value: the defect made visible instead of described.
 */
export function scopeVars(s: ScopeState, motion: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of COLOR_ROLES) {
    if (s.dropped && s.dropped.theme === s.theme && s.dropped.role === role) continue;
    out[`--sx-${role}`] = THEMES[s.theme][role];
  }
  for (const role of SPACE_ROLES) out[`--sx-${role}`] = `${DENSITY[s.density][role]}px`;
  for (const role of TYPE_ROLES) out[`--sx-${role}`] = `${Math.round(TYPE_BASE_PX[role] * s.scale)}px`;
  return { ...out, ...motion };
}
