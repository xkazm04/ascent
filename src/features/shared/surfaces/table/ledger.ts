// The table scene's query engine, pure and tier-agnostic: the column model, typed comparators with an
// identity tiebreaker, the two window mechanics (offset, keyset) behind one request/response
// contract with an echo, the body state machine, and the performance ladder's runtime rung. The
// "client" regime calls runQuery synchronously over the whole snapshot; the "server" regime calls the
// same function behind a simulated round-trip — which is the sorting technique's cross-tier
// agreement made literal: one comparator, one sequence, whichever tier runs it. No React.

import { PAGE_SIZE, type Repo, type RepoStatus } from "./fixtures";

export type ColId = "name" | "level" | "score" | "commits" | "status" | "scanned";
export type Dir = "asc" | "desc";
export type Sort = { col: ColId; dir: Dir };

/** Columns are data: id, label, semantic type, alignment, and the direction a first click chooses. */
export type Column = { id: ColId; label: string; kind: "text" | "number" | "rank" | "instant"; align: "left" | "right"; firstDir: Dir };
export const COLUMNS: readonly Column[] = [
  { id: "name", label: "Repository", kind: "text", align: "left", firstDir: "asc" },
  { id: "level", label: "Level", kind: "rank", align: "right", firstDir: "desc" },
  { id: "score", label: "Score", kind: "number", align: "right", firstDir: "desc" },
  { id: "commits", label: "Commits", kind: "number", align: "right", firstDir: "desc" },
  { id: "status", label: "Status", kind: "rank", align: "left", firstDir: "desc" },
  { id: "scanned", label: "Scanned", kind: "instant", align: "right", firstDir: "desc" },
];

/** Enumerated statuses sort by declared rank, never alphabetically. */
export const STATUS_RANK: Record<RepoStatus, number> = { fail: 3, warn: 2, queued: 1, ok: 0 };
/** The product decision, not the storage order: there is always a sort. */
export const DEFAULT_SORT: Sort = { col: "score", dir: "desc" };
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** The sort value of a row for a column; null is "absent", which has ONE home (last, either direction). */
export function sortValue(r: Repo, col: ColId): number | string | null {
  switch (col) {
    case "name": return r.name;
    case "level": return r.level;
    case "score": return r.score;
    case "commits": return r.commits;
    case "status": return STATUS_RANK[r.status];
    case "scanned": return r.scannedDaysAgo === null ? null : -r.scannedDaysAgo; // newer = larger instant
  }
}

/** Typed comparison of two sort values under a direction; absent (null) has ONE home: last, either way. */
function cmpValues(va: number | string | null, vb: number | string | null, dir: Dir): number {
  if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
  const c = typeof va === "string" && typeof vb === "string" ? collator.compare(va, vb) : (va as number) - (vb as number);
  return dir === "asc" ? c : -c;
}

/** Total, deterministic order: typed comparison, absent last regardless of direction, id as the last term. */
export function compare(a: Repo, b: Repo, sort: Sort): number {
  const c = cmpValues(sortValue(a, sort.col), sortValue(b, sort.col), sort.dir);
  if (c !== 0) return c;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // the tiebreaker is identity, never a timestamp or a label
}

export const sortRepos = (rows: readonly Repo[], sort: Sort): Repo[] => [...rows].sort((a, b) => compare(a, b, sort));
export const matches = (r: Repo, filter: string): boolean => filter.trim() === "" || r.name.includes(filter.trim().toLowerCase());

// ---- The window and the request/response contract ------------------------------------------------

export type Window = { kind: "offset"; page: number } | { kind: "keyset"; cursor: string | null };
export type Query = { filter: string; sort: Sort; window: Window };
export type Response = {
  rows: Repo[];
  /** Exact only when the tier could afford a full predicate scan; otherwise a bound (`hasMore`). */
  total: { kind: "exact"; n: number } | { kind: "bound"; hasMore: boolean };
  nextCursor: string | null;
  /** The query this response actually answered — what lets a client discard a stale one. */
  echo: Query;
};

/** The cursor is the ordering-key tuple of the last delivered row, sealed with the order it belongs to. */
export function encodeCursor(last: Repo, sort: Sort): string {
  return btoa(JSON.stringify([sort.col, sort.dir, sortValue(last, sort.col), last.id]));
}
export function decodeCursor(cursor: string, sort: Sort): { value: number | string | null; id: string } | null {
  try {
    const [col, dir, value, id] = JSON.parse(atob(cursor)) as [ColId, Dir, number | string | null, string];
    if (col !== sort.col || dir !== sort.dir) return null; // minted under another order: refused, not replayed
    return { value, id };
  } catch {
    return null;
  }
}

/**
 * One executor for both tiers. `exactTotal` is the cost decision: a small set pays the full predicate
 * scan for "1–25 of 312"; a large one fetches `PAGE_SIZE + 1` and reports a bound.
 */
export function runQuery(data: readonly Repo[], q: Query, exactTotal: boolean): Response {
  const filtered = sortRepos(data.filter((r) => matches(r, q.filter)), q.sort);
  let start = 0;
  if (q.window.kind === "offset") start = Math.max(0, q.window.page - 1) * PAGE_SIZE;
  else if (q.window.cursor) {
    const c = decodeCursor(q.window.cursor, q.sort);
    // The next-window predicate compares the WHOLE tuple: the first row strictly after (value, id).
    if (c) start = filtered.findIndex((r) => cmpValues(sortValue(r, q.sort.col), c.value, q.sort.dir) > 0 || (cmpValues(sortValue(r, q.sort.col), c.value, q.sort.dir) === 0 && r.id > c.id));
    if (start < 0) start = filtered.length;
  }
  const rows = filtered.slice(start, start + PAGE_SIZE);
  const hasMore = start + PAGE_SIZE < filtered.length;
  const last = rows[rows.length - 1];
  return {
    rows,
    total: exactTotal ? { kind: "exact", n: filtered.length } : { kind: "bound", hasMore },
    nextCursor: hasMore && last ? encodeCursor(last, q.sort) : null,
    echo: q,
  };
}

// ---- The body state machine ------------------------------------------------------------------------

export type BodyState = "empty-loading" | "populated" | "populated-refreshing" | "empty-settled" | "error";

/** Presence of rows dominates everything but a hard failure with nothing to show; empty needs `settled`. */
export function bodyState(inFlight: boolean, rowCount: number, settled: boolean, error: string | null): BodyState {
  if (error && rowCount === 0) return "error";
  if (inFlight && rowCount === 0) return "empty-loading";
  if (rowCount > 0) return inFlight ? "populated-refreshing" : "populated";
  return settled ? "empty-settled" : "empty-loading";
}

// ---- Regime and the ladder ----------------------------------------------------------------------------

export type Regime = "client" | "server";
/** The all-client bet, written down: past this many rows the snapshot regime is refused, not tuned. */
export const ALL_CLIENT_BOUND = 5_000;
export const regimeAllowed = (regime: Regime, volume: number): boolean => regime === "server" || volume <= ALL_CLIENT_BOUND;

/** The performance ladder's rung, chosen at runtime from the count the surface was handed — one decision site. */
export function rungFor(volume: number): { rung: 2 | 3; why: string } {
  if (volume <= PAGE_SIZE) return { rung: 2, why: "one page holds the whole set: pay for the view model, nothing above it" };
  return { rung: 3, why: `the window caps the mount at ${PAGE_SIZE} rows; memoized rows repaint one row per toggle. Rung 4 is refused: it would take find-in-page away to mount fewer than 25 rows.` };
}

/** Placeholder bar widths, seeded by position: rows of data, not a barcode. */
export const ghostWidth = (row: number, col: number): number => 35 + ((((row * 7 + col * 13) * 2654435761) >>> 0) % 55);
