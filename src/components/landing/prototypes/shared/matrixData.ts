// Real data behind every variant's "matrix" section: the 9 scoring dimensions × the 3 archetype
// weighting lenses (Solo / Team / Org). The numbers are the actual ARCHETYPE_WEIGHTS the scoring
// engine uses — so the matrix tells a true story (e.g. Testing & Tooling dominate the Solo lens;
// CI/CD & Agentic carry more under the Org lens), not a decorative grid.

import { DIMENSIONS, ARCHETYPE_WEIGHTS } from "@/lib/maturity/model";
import { DIMENSION_SHORT } from "@/lib/ui";
import type { Axis, DimensionId } from "@/lib/types";

export interface MatrixRow {
  id: DimensionId;
  name: string;
  short: string;
  axis: Axis;
  description: string;
  base: number; // base (org-default) weight, 0..1
  solo: number;
  team: number;
  org: number;
}

export const ARCHETYPE_COLUMNS = [
  { key: "solo", label: "Solo", sub: "Early-stage" },
  { key: "team", label: "Team", sub: "Product" },
  { key: "org", label: "Org", sub: "Platform" },
] as const;

export type ArchetypeKey = (typeof ARCHETYPE_COLUMNS)[number]["key"];

export const AXIS_LABEL: Record<Axis, string> = {
  adoption: "AI Adoption",
  rigor: "Engineering Rigor",
};

export function buildMatrixRows(): MatrixRow[] {
  return DIMENSIONS.map((d) => ({
    id: d.id,
    name: d.name,
    short: DIMENSION_SHORT[d.id],
    axis: d.axis,
    description: d.description,
    base: d.weight,
    solo: ARCHETYPE_WEIGHTS.solo[d.id],
    team: ARCHETYPE_WEIGHTS.team[d.id],
    org: ARCHETYPE_WEIGHTS.org[d.id],
  }));
}

/** Largest single weight across all lenses — normalizes cell intensity so the heaviest cell is fully saturated. */
export const MAX_WEIGHT = Math.max(
  ...DIMENSIONS.flatMap((d) => [
    ARCHETYPE_WEIGHTS.solo[d.id],
    ARCHETYPE_WEIGHTS.team[d.id],
    ARCHETYPE_WEIGHTS.org[d.id],
  ]),
);

/** Azure-accent fill whose alpha scales with a weight (honest: more weight = more present). */
export function weightTint(w: number, min = 0.05, max = 0.9): string {
  const t = MAX_WEIGHT > 0 ? w / MAX_WEIGHT : 0;
  const a = min + t * (max - min);
  return `rgba(59, 158, 255, ${a.toFixed(3)})`;
}

/** Contrast-aware numeral color for a tinted cell: dark ink on the heavy (bright azure) cells, light
 *  slate on the faint ones — so the weight reads at every intensity (mirrors heatCell's logic). */
export function weightText(w: number): string {
  const t = MAX_WEIGHT > 0 ? w / MAX_WEIGHT : 0;
  return t > 0.5 ? "#04070e" : "#e2e8f0";
}

/** Percent string for a 0..1 weight (the matrix displays weights as whole-number percents). */
export function pct(w: number): string {
  return `${Math.round(w * 100)}%`;
}
