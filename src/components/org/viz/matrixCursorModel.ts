// The keyboard model behind MatrixGrid's inspect mode. Pure: no React, no DOM.
//
// A matrix is ONE composite widget: one tab stop from outside, arrow keys inside, Home/End to the
// row's edges, Ctrl+Home/Ctrl+End to the grid's corners, no wrap at an edge (the ARIA grid pattern).
// The roving position is keyed by the row's IDENTITY, never its index: when rows resort or a row
// disappears, the cursor follows its subject or falls to the nearest surviving neighbour, never to
// whatever now sits in the slot it used to occupy.
//
// The readout text is built here too, so the visible line and each cell's accessible name come from
// one composer, and `rendersValue` gates the numeral in it exactly as it gates the painted cell.
// Named apart from MatrixReadout.tsx on purpose (the filesystem is case-insensitive).

import { fmtNum, isNum } from "@/components/org/viz/vizNum";
import { STATE_HINT, STATE_LABEL, rendersValue } from "@/components/org/viz/states";
import type { MatrixCell } from "@/components/org/viz/matrixShared";

export type MatrixCursor = { rowId: string; axis: string };

const clamp = (i: number, n: number) => Math.min(Math.max(i, 0), n - 1);

/**
 * The cursor after `key`, or `null` when the key is not one the grid owns (Tab, letters, …), so the
 * caller leaves that event to the browser. An arrow at an edge returns the same position: a stop,
 * not a wrap.
 */
export function moveCursor(
  cursor: MatrixCursor,
  key: string,
  rowIds: readonly string[],
  axes: readonly string[],
  mods: { ctrl?: boolean } = {},
): MatrixCursor | null {
  if (rowIds.length === 0 || axes.length === 0) return null;
  const r = Math.max(rowIds.indexOf(cursor.rowId), 0);
  const c = Math.max(axes.indexOf(cursor.axis), 0);
  const at = (ri: number, ci: number): MatrixCursor => ({
    rowId: rowIds[clamp(ri, rowIds.length)]!,
    axis: axes[clamp(ci, axes.length)]!,
  });
  switch (key) {
    case "ArrowRight":
      return at(r, c + 1);
    case "ArrowLeft":
      return at(r, c - 1);
    case "ArrowDown":
      return at(r + 1, c);
    case "ArrowUp":
      return at(r - 1, c);
    case "Home":
      return mods.ctrl ? at(0, 0) : at(r, 0);
    case "End":
      return mods.ctrl ? at(rowIds.length - 1, axes.length - 1) : at(r, axes.length - 1);
    default:
      return null;
  }
}

/**
 * Where the cursor belongs once the rows change. Its own row if it survived (wherever it moved to);
 * otherwise the nearest surviving neighbour in the PREVIOUS order, looking forward first. `null`
 * when nothing survived.
 */
export function cursorAfterRowsChange(
  cursor: MatrixCursor,
  prevIds: readonly string[],
  nextIds: readonly string[],
): MatrixCursor | null {
  if (nextIds.length === 0) return null;
  if (nextIds.includes(cursor.rowId)) return cursor;
  const next = new Set(nextIds);
  const from = prevIds.indexOf(cursor.rowId);
  if (from >= 0) {
    for (let d = 1; d < prevIds.length; d++) {
      const after = prevIds[from + d];
      if (after !== undefined && next.has(after)) return { rowId: after, axis: cursor.axis };
      const before = prevIds[from - d];
      if (before !== undefined && next.has(before)) return { rowId: before, axis: cursor.axis };
    }
  }
  return { rowId: nextIds[0]!, axis: cursor.axis };
}

/**
 * The live cursor for this render: the remembered one carried across any row change, with an axis
 * that is still drawn, defaulting to the first cell. `null` only for an empty grid.
 */
export function resolveCursor(
  cursor: MatrixCursor | null,
  idsAtCursor: readonly string[],
  rowIds: readonly string[],
  axes: readonly string[],
): MatrixCursor | null {
  if (rowIds.length === 0 || axes.length === 0) return null;
  const carried = cursor ? cursorAfterRowsChange(cursor, idsAtCursor, rowIds) : null;
  if (!carried) return { rowId: rowIds[0]!, axis: axes[0]! };
  return axes.includes(carried.axis) ? carried : { rowId: carried.rowId, axis: axes[0]! };
}

/** A cell's accessible name: subject · axis: state, plus the value only where the state prints one. */
export function cellName(subject: string, axis: string, cell: MatrixCell): string {
  const value = rendersValue(cell.state) && isNum(cell.score) ? ` ${fmtNum(cell.score, 0)}` : "";
  return `${subject} · ${axis}: ${STATE_LABEL[cell.state]}${value}`;
}

/** The pinned readout: the cell's name, then the state's one-sentence caveat. */
export function readoutText(subject: string, axis: string, cell: MatrixCell): string {
  return `${cellName(subject, axis, cell)}. ${STATE_HINT[cell.state]}`;
}
