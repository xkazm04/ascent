// Pair model for the trend timeline: which two scans a move compares, and the compare URL for them.
//
// Every event on the trends page (a promotion, a regression, a deploy, any dip the reader picks off
// the line) is a move BETWEEN two scans. The compare page already takes `?a=` (the newer scan, the
// candidate) and `?b=` (the older scan, the baseline) and narrates "Why it moved"; this module names
// the pair and builds that link, so an event opens its own diff in one click.
//
// Roles are chronological, never click order: the older scan is always the baseline. A pair that is
// not two real scans is refused (null) rather than linked: a self-pair would render an empty diff as
// a finding, and a compacted point (a period mean retention kept after deleting the scans) has no
// scan behind it for the compare page to load.
//
// PURE + no React, and client-safe: DimensionTrends (a client component) imports it, so it must not
// reach `@/lib/db`. The compacted-id prefix and the URL encoding are therefore mirrored here, and
// their parity with `isCompactedPointId` (scans-read.ts) and `historyReturnPath("compare", ...)`
// (repoHistoryAccess.ts) is pinned in trendPairModel.test.ts.

/** Mirrors `COMPACTED_POINT_ID_PREFIX` in src/lib/db/scans-read.ts (parity pinned by test). */
export const COMPACTED_ID_PREFIX = "digest:";

/** True for a compacted period point's id (a mean over deleted scans, not a scan). */
export function isCompactedId(id: string): boolean {
  return id.startsWith(COMPACTED_ID_PREFIX);
}

/** The two sides of a compare pair, named by role: `afterId` is the newer scan, `beforeId` the older. */
export interface ScanPair {
  afterId: string;
  beforeId: string | null;
}

/**
 * The compare page URL for one pair, or null when the pair is not two distinct real scans.
 * Same encoding as `historyReturnPath("compare", { repo, a, b })`.
 */
export function pairCompareHref(repoFullName: string, pair: ScanPair): string | null {
  const { afterId, beforeId } = pair;
  if (!afterId || !beforeId) return null;
  if (afterId === beforeId) return null;
  if (isCompactedId(afterId) || isCompactedId(beforeId)) return null;
  return `/report/compare?repo=${encodeURIComponent(repoFullName)}&a=${encodeURIComponent(afterId)}&b=${encodeURIComponent(beforeId)}`;
}

/** The predecessor id to carry on a marker: null when the predecessor is absent or compacted. */
export function previousRealScanId(prev: { id: string } | undefined | null): string | null {
  if (!prev) return null;
  return isCompactedId(prev.id) ? null : prev.id;
}

/**
 * Two-point pick state. `selected` holds at most two ids, kept in CHRONOLOGICAL order (older
 * first), so the pair's roles never depend on which point was clicked first.
 */
export interface PickState {
  selected: readonly string[];
}

export const EMPTY_PICK: PickState = { selected: [] };

export type PickAction =
  /** Toggle one point. `order` is the chart's chronological (oldest-first) id list. */
  | { type: "pick"; id: string; order: readonly string[] }
  /** Keep only the picks still in `ids` (the range toggle narrowed the slice). */
  | { type: "retain"; ids: readonly string[] }
  | { type: "clear" };

export function pickReducer(state: PickState, action: PickAction): PickState {
  if (action.type === "clear") return state.selected.length === 0 ? state : EMPTY_PICK;
  if (action.type === "retain") {
    const keep = new Set(action.ids);
    const next = state.selected.filter((id) => keep.has(id));
    return next.length === state.selected.length ? state : { selected: next };
  }
  const { id, order } = action;
  const rank = new Map(order.map((x, i) => [x, i]));
  // A compacted point or an id the chart does not hold is not a scan to compare: no change.
  if (isCompactedId(id) || !rank.has(id)) return state;
  if (state.selected.includes(id)) return { selected: state.selected.filter((x) => x !== id) };
  // A third pick replaces the OLDER of the two, so the newer side stays the candidate.
  const base = state.selected.length >= 2 ? state.selected.slice(1) : state.selected;
  const next = [...base, id].sort((x, y) => (rank.get(x) ?? 0) - (rank.get(y) ?? 0));
  return { selected: next };
}

/** The picked pair by role, or null until two points are picked. */
export function pickedPair(state: PickState): { beforeId: string; afterId: string } | null {
  if (state.selected.length < 2) return null;
  return { beforeId: state.selected[0]!, afterId: state.selected[1]! }; // safe: length >= 2
}
