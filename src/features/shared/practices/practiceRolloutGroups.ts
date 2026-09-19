// The Practice Library as ONE surface: every practice, grouped by the dimension it lifts, each row
// carrying its four rollout stages. Pure: no React, no fetch.
//
// Until 2026-09-16 the library had two readings of the same rows — the rollout matrix (the first 8
// practices, as stage states) and the ledger table under it (every practice, as counts and a meter).
// The merge keeps the matrix's encoding as the baseline and gives it the ledger's reach: all rows,
// not eight, and the dimension grouping that answers "where does our adoption actually sit".

import { isNum, type MatrixCell } from "@/components/org/viz";
import { categoryLabel, type PracticeRow } from "./practiceRows";
import { rolloutCellsFor } from "./practiceRolloutViz";

export type RolloutSource = "all" | "authored" | "mined";

export interface RolloutEntry {
  row: PracticeRow;
  /** The four stage cells, in `ROLLOUT_AXES` order. */
  cells: MatrixCell[];
}

export interface RolloutGroup {
  dimId: string;
  /** "D3 · CI/CD" — the ledger's category label, promoted to a group heading. */
  label: string;
  entries: RolloutEntry[];
  /**
   * Mean MEASURED adoption share across the group's assessed practices, or null when none is
   * assessed. Declared (authored) adoption is excluded on purpose: a recorded application and an
   * observed share are different numbers, and averaging them would invent one neither supports.
   */
  adopted: number | null;
  /** How many practices back `adopted`. */
  assessed: number;
}

export function matchesSource(row: Pick<PracticeRow, "source">, source: RolloutSource): boolean {
  return source === "all" || row.source === source;
}

const dimOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * Group the library's rows by dimension (D1 → D9), keeping the caller's order inside each group —
 * which is `buildPracticeRows`' order: the org's own standards first, then the widest reuse
 * opportunity.
 */
export function rolloutGroups(rows: readonly PracticeRow[], fleetSize: number, source: RolloutSource = "all"): RolloutGroup[] {
  const byDim = new Map<string, RolloutEntry[]>();
  for (const row of rows) {
    if (!matchesSource(row, source)) continue;
    const list = byDim.get(row.dimId) ?? [];
    list.push({ row, cells: rolloutCellsFor(row, fleetSize) });
    byDim.set(row.dimId, list);
  }
  return [...byDim.keys()].sort(dimOrder).map((dimId) => {
    const entries = byDim.get(dimId)!;
    const shares = entries
      .map((e) => e.cells[1])
      .filter((c): c is MatrixCell => c?.state === "measured" && isNum(c.score))
      .map((c) => c.score as number);
    return {
      dimId,
      label: categoryLabel(dimId),
      entries,
      adopted: shares.length > 0 ? Math.round(shares.reduce((s, v) => s + v, 0) / shares.length) : null,
      assessed: shares.length,
    };
  });
}

/** The group heading's readout: unit first, the measured share only where there is one. */
export function groupReadout(g: Pick<RolloutGroup, "entries" | "adopted" | "assessed">): string {
  const n = `${g.entries.length} practice${g.entries.length === 1 ? "" : "s"}`;
  return g.adopted == null ? n : `${n} · ${g.adopted}% adopted across ${g.assessed} assessed`;
}
