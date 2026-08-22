// Observatory types — the shapes layoutBodies consumes and produces. Split out of
// observatoryModel.ts purely to hold the 200-line features cap; every name here is re-exported from
// observatoryModel.ts and from the barrel, so importers never need to know this file exists.

import type { QuadrantId } from "./observatoryModel";

export interface TrailPoint {
  x: number;
  y: number;
  at: string;
}

export interface ObservatoryBody {
  kind: "body";
  fullName: string;
  name: string;
  /** Short caption rendered beside the body. */
  label: string;
  /** 0–100 data space; null only when `neverScanned`. */
  x: number | null;
  y: number | null;
  /** Radius in SVG (viewBox) units. */
  r: number;
  level: string | null;
  overall: number | null;
  adoption: number | null;
  rigor: number | null;
  /** Level ramp hex (LEVEL_HEX / scoreHex) — never a hand-picked colour. */
  fill: string;
  posture: string | null;
  quadrant: QuadrantId | null;
  /** Up to `maxTrail` earlier observations, oldest → newest. Empty when history carries no axes. */
  trail: TrailPoint[];
  lastScannedAt: string | null;
  neverScanned: boolean;
}

/** A body that actually has coordinates — the only kind the field plots. */
export type PlottedBody = ObservatoryBody & { x: number; y: number; quadrant: QuadrantId };

export const isPlotted = (b: ObservatoryBody): b is PlottedBody => b.x != null && b.y != null && !b.neverScanned;

/** The repo standing the field seeds from — structurally the war room's `LiveRepoSeed`. */
export interface ObservatorySeed {
  fullName: string;
  name: string;
  overall: number | null;
  adoption: number | null;
  rigor: number | null;
  level: string | null;
  posture: string | null;
  /** Optional; the live wall's seed does not carry it, so the field falls back to `scannedAt: null`. */
  scannedAt?: string | null;
}

export interface ObservatoryHistoryPoint {
  at: string;
  overall?: number | null;
  adoption?: number | null;
  rigor?: number | null;
}

/** Structurally satisfied by `OrgRepoHistory` (lib/db/org-rollup.ts). */
export interface ObservatoryHistory {
  fullName: string;
  points: ObservatoryHistoryPoint[];
}

/**
 * The scope the field is showing. The CALLER narrows the seeds (LiveTab already resolves the stack
 * scope); this is carried through purely so the field can caption what it is showing and so a layout
 * is reproducible from its inputs.
 */
export interface ObservatoryScope {
  stackKey?: string | null;
  segmentId?: string | null;
  label?: string | null;
}

export interface LayoutOpts {
  scope?: ObservatoryScope;
  /** Commit volume per fullName. Absent → every body gets `rDefault` (the seed carries no volume). */
  volumes?: Readonly<Record<string, number>>;
  rMin?: number;
  rMax?: number;
  rDefault?: number;
  maxTrail?: number;
}
