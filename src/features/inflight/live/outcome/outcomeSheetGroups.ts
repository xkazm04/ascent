// THE SHEET'S THIRD AXIS — a DIMENSION band between a project and its gaps.
//
// THE PROBLEM THIS SOLVES. The sheet's row axis was project → gap, one first-class row per gap, every
// one of them always expanded. Three repositories over eight runs is a hundred-odd rows of full-height
// prose, and the sheet's whole claim — *when did this gap get done, and by which run?* — needs the
// COLUMNS to be comparable, which they stop being the moment the reader has to scroll to hold two
// rows in their head. There was no level of detail between "one line per gap" and nothing.
//
// WHY DIMENSION AND NOT A TOPIC. Every candidate grouping was weighed against what the data actually
// carries, and only one is a fact rather than a guess:
//
//   • DIMENSION (chosen) — `dimId` is on the row already, it is the vocabulary the whole product
//     scores, ranks, filters and alerts in (the Proposals ledger groups by it, the Focus dial arms by
//     it), and it is CLOSED: nine values, stable, no clustering and no model in the loop. A reader
//     who sees "D9 · Security — 6 gaps, run 4 touched 3" has learned something the per-row list
//     could only be counted into by hand.
//   • KIND (closed / installed / hardened / regressed / noted) — already carried by each row's glyph,
//     so grouping by it would give the reader a second copy of something they can see.
//   • TOPIC / headline clustering — would need an LLM or a similarity heuristic at render time, could
//     not be explained to the person reading it, and would move between renders. A grouping nobody
//     can predict is worse than no grouping.
//
// A GROUP OF ONE IS NOT A GROUP. It renders as its own gap row, exactly as before — a header that
// exists to collapse one thing costs a row and saves none.
//
// Pure, and hook-free like the fold it sits on: the counts under a collapsed group are the sheet's
// only derived arithmetic, and they have to be pinnable without a renderer.

import { dimShort } from "@/lib/ui";
import type { DeliverableState } from "./outcomeGapRows";
import type { SheetGapRow } from "./outcomeSheetModel";

/** Where a row with no dimension lands. Sorts last, and says what it is rather than pretending. */
export const NO_DIM_KEY = "~nodim";

/** ONE GROUP × ONE RUN: how many of the group's gaps that run touched, and in what state. */
export interface SheetGroupCell {
  /** Rows in this group the run has a cell for. Zero groups render as an empty cell, never as "0". */
  total: number;
  byState: Record<DeliverableState, number>;
  /** Rows the owner has already ruled on — a group is "done with" when this reaches `total`. */
  reviewed: number;
}

export interface SheetGroup {
  key: string;
  /** "D9 · Security", or "No dimension". */
  label: string;
  dimId: string | null;
  rows: SheetGapRow[];
  cells: Record<string, SheetGroupCell | null>;
}

const emptyByState = (): Record<DeliverableState, number> => ({ committed: 0, uncommitted: 0, proposed: 0 });

/**
 * A project's gap rows, banded by dimension, in the dimension's own order (D1…D9, then the
 * dimension-less band). Every column gets an explicit key, so "this run touched nothing in this band"
 * and "this run does not exist" stay different facts — the same rule `buildSheetProjects` follows.
 */
export function groupSheetRows(rows: readonly SheetGapRow[], columnIds: readonly string[]): SheetGroup[] {
  const byKey = new Map<string, SheetGroup>();
  for (const row of rows) {
    const key = row.dimId ?? NO_DIM_KEY;
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        label: row.dimId ? `${row.dimId} · ${dimShort(row.dimId)}` : "No dimension",
        dimId: row.dimId,
        rows: [],
        cells: Object.fromEntries(columnIds.map((id) => [id, null])),
      };
      byKey.set(key, group);
    }
    group.rows.push(row);
    for (const id of columnIds) {
      const cell = row.cells[id];
      if (!cell) continue;
      const tally = group.cells[id] ?? { total: 0, byState: emptyByState(), reviewed: 0 };
      tally.total += 1;
      tally.byState[cell.state] += 1;
      if (cell.review) tally.reviewed += 1;
      group.cells[id] = tally;
    }
  }
  return [...byKey.values()].sort((a, b) => (a.key === NO_DIM_KEY ? 1 : 0) - (b.key === NO_DIM_KEY ? 1 : 0) || a.key.localeCompare(b.key));
}

/** A band worth collapsing. One row is not a group — it renders as itself (see the header). */
export const isBand = (group: SheetGroup): boolean => group.rows.length > 1;

/** "3 done · 1 open" — what a collapsed band's cell says under its count. Empty when the run touched
 *  nothing in the band, which renders as nothing at all rather than as a row of zeroes. */
export function groupCellCaption(cell: SheetGroupCell): string {
  const parts: string[] = [];
  if (cell.byState.committed > 0) parts.push(`${cell.byState.committed} done`);
  if (cell.byState.uncommitted > 0) parts.push(`${cell.byState.uncommitted} uncommitted`);
  if (cell.byState.proposed > 0) parts.push(`${cell.byState.proposed} open`);
  return parts.join(" · ");
}
