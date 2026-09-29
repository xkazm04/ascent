// The repo × dimension matrix's model, shared by the Altimeter heatmap and the v2 matrix: row shape, the
// absent-measurement-aware column mean, and the weakest-first sort cycle (dimension header click). Pure, so
// the two compositions cannot disagree about a mean or about what a repeated click does.
import { useMemo, useState } from "react";

export interface HeatRow {
  name: string;
  fullName: string;
  dims: { dimId: string; score: number }[];
}

export const dimScore = (r: HeatRow, d: string) => r.dims.find((x) => x.dimId === d)?.score;

/** Column mean over the repos that HAVE the dimension (a legacy scan missing a dim is excluded from
 *  that column's average rather than dragging it down as a fake 0); null when no repo has it. */
export function columnAverages(rows: HeatRow[], dims: string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const d of dims) {
    const scores = rows.map((r) => dimScore(r, d)).filter((s): s is number => s != null);
    out[d] = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  }
  return out;
}

export type HeatSort = { dim: string; dir: 1 | -1 } | null;

/** Next state of the sort after a header click: weakest first, then strongest first, then reset. */
export function nextSort(s: HeatSort, d: string): HeatSort {
  return s?.dim !== d ? { dim: d, dir: 1 } : s.dir === 1 ? { dim: d, dir: -1 } : null;
}

/** Rows ranked by the sort; repos missing the dimension rank as -1 (weakest). Unsorted returns `rows`. */
export function sortRows(rows: HeatRow[], sort: HeatSort): HeatRow[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => ((dimScore(a, sort.dim) ?? -1) - (dimScore(b, sort.dim) ?? -1)) * sort.dir);
}

/** True when any cell or any column mean is an absent measurement (drives the legend). */
export function hasMissingCells(rows: HeatRow[], dims: string[], avgs: Record<string, number | null>): boolean {
  return rows.some((r) => dims.some((d) => dimScore(r, d) == null)) || dims.some((d) => avgs[d] == null);
}

/** State + derived values for a matrix. `initialSortDim` seeds weakest-first (the ?dim= deep link). */
export function useHeatMatrix(rows: HeatRow[], dims: string[], initialSortDim?: string) {
  const [sort, setSort] = useState<HeatSort>(initialSortDim && dims.includes(initialSortDim) ? { dim: initialSortDim, dir: 1 } : null);
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const avgs = useMemo(() => columnAverages(rows, dims), [rows, dims]);
  return { sort, sorted, avgs, cycleSort: (d: string) => setSort((s) => nextSort(s, d)), hasMissing: hasMissingCells(rows, dims, avgs) };
}
