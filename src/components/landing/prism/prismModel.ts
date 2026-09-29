// The Prism landing's view of the maturity model. Everything numeric (levels, bands, weights, posture
// labels) is read from the product's own rubric in src/lib/maturity/model.ts, never re-typed, so the
// picture cannot drift from what a scan actually scores. Pure module: no DOM, no React.

import {
  ARCHETYPE_LABEL,
  ARCHETYPE_WEIGHTS,
  DIMENSIONS,
  LEVELS,
  POSTURE_META,
  SCORING_RUBRIC_VERSION,
} from "@/lib/maturity/model";
import { at } from "./at";
import type { DimensionId, MaturityLevel, RepoArchetype } from "@/lib/types";

/** The Spectral Nine: one hue per dimension, in wavelength order. Colour always names a dimension. */
export const HUES = [
  "#FF5A5F", "#FF8A3D", "#FFC247", "#D4F15B", "#62E59A", "#38D9D0", "#4CB2FF", "#7C83FF", "#BC6DFF",
] as const;

export type Archetype = RepoArchetype;
export const ARCHETYPES: readonly Archetype[] = ["solo", "team", "org"];
export const DEFAULT_ARCHETYPE: Archetype = "org";

export interface PrismDim {
  id: DimensionId;
  name: string;
  description: string;
  hue: string;
  index: number;
}

export const PRISM_DIMS: readonly PrismDim[] = DIMENSIONS.map((d, index) => ({
  id: d.id,
  name: d.name,
  description: d.description,
  hue: at(HUES, index),
  index,
}));

export const PRISM_LEVELS: readonly MaturityLevel[] = LEVELS;
export const dimAt = (i: number): PrismDim => at(PRISM_DIMS, i);
export const levelAt = (i: number): MaturityLevel => at(PRISM_LEVELS, i);
export const PRISM_POSTURES = POSTURE_META;
export const PRISM_RUBRIC = SCORING_RUBRIC_VERSION;

export const archetypeLabel = (a: Archetype): string => ARCHETYPE_LABEL[a];
/** "Solo / early-stage" -> "Solo": the short form the weighting switch prints. */
export const archetypeShort = (a: Archetype): string => ARCHETYPE_LABEL[a].split(" /")[0] ?? ARCHETYPE_LABEL[a];

/** Weight of dimension `i` under an archetype lens (0..1). */
export function weightOf(i: number, arch: Archetype): number {
  return ARCHETYPE_WEIGHTS[arch][dimAt(i).id];
}

export const pct = (w: number): string => `${Math.round(w * 100)}%`;

export function levelOf(score: number): MaturityLevel {
  for (const l of PRISM_LEVELS) if (score >= l.band[0] && score <= l.band[1]) return l;
  return levelAt(0);
}

/** The scene route: `#/line/D3` is a line, `#/line/D3/2` its second piece of evidence (1-based in the URL). */
export interface PrismRoute {
  /** Dimension index, 0..8 */
  i: number;
  /** Evidence index, 0-based, or null for the line scene itself */
  e: number | null;
}

export function parseHash(hash: string): PrismRoute | null {
  const m = hash.match(/^#\/line\/(D\d)(?:\/(\d))?$/);
  if (!m) return null;
  const i = PRISM_DIMS.findIndex((d) => d.id === m[1]);
  if (i < 0) return null;
  return { i, e: m[2] != null ? Number(m[2]) - 1 : null };
}

export const lineHash = (i: number, e?: number | null): string =>
  `#/line/${dimAt(i).id}${e != null ? `/${e + 1}` : ""}`;

/** Wrap-around neighbours for the stepper. */
export const prevLine = (i: number): number => (i + PRISM_DIMS.length - 1) % PRISM_DIMS.length;
export const nextLine = (i: number): number => (i + 1) % PRISM_DIMS.length;
