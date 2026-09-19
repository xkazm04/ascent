// The ONE scan-history depth every "same history, different surface" path shares.
//
// Before this constant the trends page fetched the newest 60 scans while the CSV export pulled 200,
// so the chart's "All" range and the spreadsheet a user downloaded three seconds later disagreed
// about what "all of this repo's history" meant — with nothing on screen admitting the chart had been
// truncated (G5-24). Both paths now read the same cap.
//
// 200 is not arbitrary: `loadRepositoryHistory` clamps `limit` to `1..200`, so 200 IS the deepest
// history any reader can obtain. Asking for more is silently the same query. Keep this in step with
// that clamp (src/lib/db/scans-read.ts) — `historyCapNote` below is what tells the user when the cap
// is actually binding, so an honest number here is load-bearing for honest copy.

/** Deepest scan history any surface reads. Mirrors the DB reader's hard clamp. */
export const HISTORY_SCAN_CAP = 200;

/**
 * True when a returned series is exactly `HISTORY_SCAN_CAP` long — i.e. the cap may be hiding older
 * scans. It is deliberately a "may": a repo with exactly 200 scans is indistinguishable from one with
 * 500 without a second COUNT query, so the copy below hedges rather than asserting a number we did
 * not measure.
 */
export function isHistoryCapped(scanCount: number): boolean {
  return scanCount >= HISTORY_SCAN_CAP;
}

/** User-facing note for a capped series, or null when the whole history is on screen. */
export function historyCapNote(scanCount: number): string | null {
  if (!isHistoryCapped(scanCount)) return null;
  return `Showing the newest ${HISTORY_SCAN_CAP} scans: “All” is capped at this depth, and the CSV export covers exactly the same ${HISTORY_SCAN_CAP}.`;
}
