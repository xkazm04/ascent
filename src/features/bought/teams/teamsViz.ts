// The Teams tab's view models — the numbers behind its two shapes, computed once and pure.
//
// Two sentences the tab used to say in prose are computed here instead:
//   "…leads at 78 and …trails at 41, a 37-point spread across 6 teams" → `teamSpread`, plotted by
//   `Distribution` (the whisker IS the spread, the box IS where the middle of the fleet sits).
//   "…and per-dimension averages in one grid" → `dimMatrixRows`, plotted by `MatrixGrid`, where a
//   dimension a team was never scored on is HATCHED and carries no numeral — the old numeric grid
//   printed a bare "·" in a column of numbers and relied on a `title` to say what it meant.
//
// Pure: no React, no DB. The kit types are `import type`, so a server component importing this pulls
// in nothing client-side.
//
// The quantile maths is a deliberate local copy of the R-7 method (the same decision, and the same
// reason, as `src/features/standing/repositories/fleetShape.ts`): `src/features/<group>/<tab>/` is
// the ownership boundary, and a cross-group import would make one tab's refactor another's
// regression.

import type { MatrixRow, VizState } from "@/components/org/viz";
import type { TeamRollup } from "@/lib/db";

export type FiveNumber = { min: number; q1: number; median: number; q3: number; max: number };

/** Linear interpolation between order statistics (R-7, the spreadsheet PERCENTILE default). */
function quantileAt(sorted: readonly number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo] as number;
  if (lo === hi) return a;
  const b = sorted[hi] as number;
  return a + (b - a) * (idx - lo);
}

/**
 * The five-number summary of the fleet's TEAM maturity averages, or null when fewer than two teams
 * carry one — a "distribution" over a single observation is a point drawn as a spread. Non-finite
 * entries are dropped rather than coerced to 0 (§2.4: a missing measurement is never a zero), so `n`
 * is what actually backed the box.
 */
export function teamSpread(teams: readonly TeamRollup[]): (FiveNumber & { n: number }) | null {
  const clean = teams
    .map((t) => t.avgOverall)
    .filter((v): v is number => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (clean.length < 2) return null;
  return {
    min: clean[0] as number,
    q1: quantileAt(clean, 0.25),
    median: quantileAt(clean, 0.5),
    q3: quantileAt(clean, 0.75),
    max: clean[clean.length - 1] as number,
    n: clean.length,
  };
}

/**
 * One `MatrixRow` per team, one cell per dimension, in the caller's row order (so sorting the table
 * re-orders the heat matrix with it).
 *
 * A dimension the team's live-scored repos were never graded on is `not-judged`, NOT a zero and not
 * a dash: `rendersValue` then makes it structurally impossible for the cell to print a numeral. That
 * is the same rule `rollupTeams` now applies to `aiCommitShare`, one level down.
 */
export function dimMatrixRows(teams: readonly TeamRollup[], dims: readonly string[]): MatrixRow[] {
  return teams.map((t) => {
    const byId = new Map(t.dimAverages.map((d) => [d.dimId, d.avg]));
    return {
      id: t.slug,
      label: t.name,
      cells: dims.map((d) => {
        const avg = byId.get(d);
        return avg == null ? { state: "not-judged" as VizState } : { state: "measured" as VizState, score: avg };
      }),
    };
  });
}

/** Only the states actually present, in chart order — the Legend contract (never a static six rows). */
export function dimMatrixStates(rows: readonly MatrixRow[]): VizState[] {
  const order: VizState[] = ["measured", "not-judged"];
  return order.filter((s) => rows.some((r) => r.cells.some((c) => c.state === s)));
}

/** How many (team, dimension) pairs the fleet has no grade for — the count beside the matrix. */
export function unjudgedCellCount(rows: readonly MatrixRow[]): number {
  return rows.reduce((n, r) => n + r.cells.filter((c) => c.state === "not-judged").length, 0);
}
