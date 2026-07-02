// Real data behind every variant's "matrix" section: the 9 scoring dimensions × the 3 archetype
// weighting lenses (Solo / Team / Org). The numbers are the actual ARCHETYPE_WEIGHTS the scoring
// engine uses — so the matrix tells a true story (e.g. Testing & Tooling dominate the Solo lens;
// CI/CD & Agentic carry more under the Org lens), not a decorative grid.

import { DIMENSIONS, ARCHETYPE_WEIGHTS } from "@/lib/maturity/model";
import type { Axis, DimensionId } from "@/lib/types";

export interface MatrixRow {
  id: DimensionId;
  name: string;
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

export const AXIS_LABEL: Record<Axis, string> = {
  adoption: "AI Adoption",
  rigor: "Engineering Rigor",
};

export function buildMatrixRows(): MatrixRow[] {
  return DIMENSIONS.map((d) => ({
    id: d.id,
    name: d.name,
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

/**
 * Fixed track ceiling the bars are drawn against (the heaviest weight rounded UP to the next 5%). Scaling
 * bar length by `w / TRACK_MAX` instead of `w / MAX_WEIGHT` keeps the bar proportional to the ABSOLUTE
 * percent printed beside it — so a 20% cell no longer renders a full-track bar captioned "20%". Derived
 * from the data, so it tracks the model if the weights change. */
export const TRACK_MAX = Math.ceil(MAX_WEIGHT * 20) / 20;

/** Percent string for a 0..1 weight (the matrix displays weights as whole-number percents). */
export function pct(w: number): string {
  return `${Math.round(w * 100)}%`;
}
