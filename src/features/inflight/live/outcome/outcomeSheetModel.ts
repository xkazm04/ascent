// THE SHEET'S ROW AXIS — the pure fold that turns the outcome matrix into an EXCEL SHEET.
//
// The matrix is one cell per (run, repo). A sheet is not: its row axis is made of FIRST-CLASS ROWS —
// a project header row, then one row per GAP under it, the project name never repeated — and its
// column axis stays the runs. So a gap has to be identified ACROSS runs, which is what `gapKey`
// (outcomeGapRows.ts) is for: a gap worked in run 3 and revisited in run 7 is ONE row with content
// in those two columns and BLANK cells everywhere else. The blanks are the point — "when did this
// get done" is then readable at a glance, which a per-run list of gaps can never be.
//
// Pure, and deliberately hook-free: the sheet's DOM is large enough that the fold has to be pinnable
// without a renderer.

import type { LaneDeliverableKind } from "@/lib/db/loop-runs-types";
import { gapKey, rowCover, type DeliverableState, type GapRow } from "./outcomeGapRows";
import type { OutcomeCell, OutcomeMatrix } from "./outcomeMatrix";

/** A review click, addressed run → lane → row key (the row's first covered id, else its headline). */
export type CellReviewHandler = (runId: string, laneId: string, cover: string, verdict: "approved" | "dismissed") => void;

/** ONE CELL of the sheet: what a single run did to a single gap. Null where the run did not touch it. */
export interface SheetGapCell {
  runId: string;
  /** The lane to POST a review against, and the key the review is addressed by. */
  laneId: string;
  cover: string;
  state: DeliverableState;
  kind: LaneDeliverableKind;
  /** THIS run's wording for the gap — a later run may phrase the same gap differently, and a wide
   *  column shows the per-run headline rather than the row label's. */
  headline: string;
  evidence: string | null;
  dimId: string | null;
  review: "approved" | "dismissed" | null;
}

/** ONE ROW of the sheet: a gap, across every run column. */
export interface SheetGapRow {
  key: string;
  /** The row's label — the LATEST run's wording, so the sticky column reads as the current truth. */
  headline: string;
  dimId: string | null;
  kind: LaneDeliverableKind;
  cells: Record<string, SheetGapCell | null>;
}

/** ONE PROJECT: its header row (the repo, its cumulative lift, its per-run verdict cells) and its gaps. */
export interface SheetProject {
  repo: string;
  /** Cumulative attributable lift across the visible columns; null when no cell is attributable. */
  lift: number | null;
  /** The repo's own (run → cell) row — the group header's per-run verdict/live marker. */
  headerCells: Record<string, OutcomeCell | null>;
  rows: SheetGapRow[];
}

const toCell = (runId: string, row: GapRow): SheetGapCell => ({
  runId,
  laneId: row.laneId,
  cover: rowCover(row),
  state: row.state,
  kind: row.kind,
  headline: row.headline,
  evidence: row.evidence,
  dimId: row.dimId,
  review: row.review ?? null,
});

/**
 * The matrix, re-cut as sheet projects. Runs are walked in the matrix's own chronological order, so a
 * row's label, dimension and kind end up being the LATEST run's account of that gap while the earlier
 * runs keep their own wording in their own cells.
 */
export function buildSheetProjects(matrix: OutcomeMatrix): SheetProject[] {
  const ids = matrix.columns.map((c) => c.id);
  return matrix.groups.map((group) => {
    const headerCells: Record<string, OutcomeCell | null> = {};
    for (const id of ids) headerCells[id] = group.cells[id] ?? null;

    const byKey = new Map<string, SheetGapRow>();
    for (const id of ids) {
      const cell = group.cells[id];
      if (!cell) continue;
      for (const row of cell.rows) {
        const key = gapKey(row);
        const existing = byKey.get(key);
        // Every column gets an explicit key so a reader of this fold — and the renderer — never has to
        // tell "this run had nothing for this gap" apart from "this run does not exist".
        const target = existing ?? { key, headline: row.headline, dimId: row.dimId, kind: row.kind, cells: Object.fromEntries(ids.map((i) => [i, null])) };
        target.headline = row.headline;
        target.dimId = row.dimId ?? target.dimId;
        target.kind = row.kind;
        target.cells[id] = toCell(cell.runId, row);
        if (!existing) byKey.set(key, target);
      }
    }
    return { repo: group.repo, lift: group.lift, headerCells, rows: [...byKey.values()] };
  });
}

/** The cell whose lane the project header offers a PR for: the latest run that already opened one
 *  (so the header shows the link), else the latest run at all — `LanePrAction` itself decides whether
 *  an offer is legal, so this only has to pick the lane the offer would be about. */
export function prCell(project: SheetProject, columns: readonly { id: string }[]): OutcomeCell | null {
  const cells = columns.map((c) => project.headerCells[c.id] ?? null).filter((c): c is OutcomeCell => c != null);
  return [...cells].reverse().find((c) => c.prUrl != null) ?? cells[cells.length - 1] ?? null;
}
