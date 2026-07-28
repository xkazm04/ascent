// The war-room's ONE settled announcement: the headline strip's four tiles rendered as a single
// spoken sentence.
//
// DECISION (G6-07 / G6-21): the wall keeps exactly one polite announcer ACTIVE at a time.
//  - While a scan runs, that announcer is the header's coalesced "N/M repos" progress count.
//  - When the numbers settle, this sentence speaks once — the outcome, not the ticks.
// The tiles themselves tween on every landed result, and the movers ticker gains a row per repo;
// neither may be a live region, or a 40-repo fleet scan becomes ~120 queued utterances that never
// finish reading. See LiveWarRoomStat.tsx (useSettledAnnouncement) for the debounce.

export interface HeadlineAnnounceStats {
  avgOverall: number | null;
  avgAdoption: number | null;
  avgRigor: number | null;
  aiNative: number;
  scored: number;
}

/** " up 4" / " down 4" / "" — spoken direction, never a glyph (SRs read "▲" inconsistently). */
function movement(delta: number | null | undefined): string {
  if (delta == null || !Number.isFinite(delta) || delta === 0) return "";
  return delta > 0 ? `, up ${delta}` : `, down ${Math.abs(delta)}`;
}

/**
 * One sentence carrying everything the four headline tiles show. Deltas are named ONCE at the end
 * rather than repeated per metric — "since kickoff" three times is the kind of padding that makes a
 * live region tiring to listen to.
 */
export function headlineAnnouncement(
  stats: HeadlineAnnounceStats,
  deltas?: { overall: number; adoption: number; rigor: number } | null,
): string {
  if (stats.scored <= 0) return "Fleet headline metrics: no repos scored yet.";
  const parts: string[] = [];
  if (stats.avgOverall != null) parts.push(`org maturity ${stats.avgOverall}${movement(deltas?.overall)}`);
  if (stats.avgAdoption != null) parts.push(`AI adoption ${stats.avgAdoption}${movement(deltas?.adoption)}`);
  if (stats.avgRigor != null) parts.push(`engineering rigor ${stats.avgRigor}${movement(deltas?.rigor)}`);
  parts.push(`${stats.aiNative} of ${stats.scored} scored ${stats.scored === 1 ? "repo" : "repos"} AI-Native`);
  const moved =
    deltas != null &&
    [deltas.overall, deltas.adoption, deltas.rigor].some((d) => Number.isFinite(d) && d !== 0);
  return `Fleet headline metrics: ${parts.join("; ")}.${moved ? " Changes since campaign kickoff." : ""}`;
}
