// Which rows a chart's Legend shows, derived from the same inputs and rules the chart paints from.
//
// `Legend` renders whatever list it is handed, and its contract is "only the states PRESENT in the
// data". Before this module every call site re-derived that list by hand: sixteen helpers, each with
// its own private whitelist and order, none of which could see MatrixGrid's void padding (a short row
// paints `missing` cells through `cellAt`) and two of which disagreed on BandLadder's edge default.
// A legend maintained beside the chart drifts from it; a legend derived from the chart's own inputs
// cannot, and `legendStates.dom.test.tsx` pins painted == listed against the real components.
//
// Server-safe and pure: no hooks, no client boundary. The chart types are `import type`.

import { cellAt, type MatrixRow } from "@/components/org/viz/matrixShared";
import { VIZ_STATES, type VizState } from "@/components/org/viz/states";
import type { LadderBand, LadderEdge } from "@/components/org/viz/BandLadder";

/** The distinct states in `states`, in the vocabulary's own order (`VIZ_STATES`). */
export function vizStatesInOrder(states: Iterable<VizState>): VizState[] {
  const present = new Set(states);
  return VIZ_STATES.filter((s) => present.has(s));
}

/**
 * The states `<MatrixGrid axes rows>` paints: one cell per row per axis, a short row padded with the
 * void `cellAt` returns, a cell past the last axis never drawn, and nothing at all where the grid
 * falls back to its placeholder (no axes or no rows).
 */
export function matrixLegendStates(axes: readonly string[], rows: readonly MatrixRow[]): VizState[] {
  if (axes.length === 0 || rows.length === 0) return [];
  const painted: VizState[] = [];
  for (const row of rows) for (let i = 0; i < axes.length; i++) painted.push(cellAt(row, i).state);
  return vizStatesInOrder(painted);
}

/**
 * The states `<BandLadder bands edge>` paints: every band's own state, plus the edge's state when an
 * edge is drawn, defaulting to `missing` exactly as BandLadder does. Nothing where the ladder falls
 * back to its placeholder (no bands), even if an edge was passed: the placeholder draws no edge.
 * (BandLadder's geometry also clips bands past the seventh inset; no consumer comes near that.)
 */
export function ladderLegendStates(bands: readonly LadderBand[], edge: LadderEdge | null | undefined): VizState[] {
  if (bands.length === 0) return [];
  const painted: VizState[] = bands.map((b) => b.state);
  if (edge) painted.push(edge.state ?? "missing");
  return vizStatesInOrder(painted);
}
