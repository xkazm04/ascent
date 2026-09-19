// Tagged vs scored counts for segment chips, rollup cards, and compare tiles.
//
// Two universes sit on one screen (G4-08): listSegments.repoCount is every repo TAGGED into the
// segment; SegmentSummary.scannedCount is how many of those carry a scan. A missing average is not a
// zero — never print "0 scored" for a slice nobody has scanned (repositories-segments #4).

/** `scored` is null when the slice has no average. Tagged 0 is a real empty tag list; scored 0 is not. */
export function taggedScoredLabel(tagged: number | null, scored: number | null): string {
  const bits: string[] = [];
  if (tagged !== null) bits.push(`${tagged} tagged`);
  if (scored !== null) bits.push(`${scored} scored`);
  return bits.join(" · ");
}

/** Compare-tile subline: posture (or "no scans yet") plus tagged vs scored. Missing scores stay blank. */
export function compareCountSub(opts: {
  score: number | null;
  scannedCount: number;
  tagged: number | null;
  postureLine: string;
}): string {
  const counts = taggedScoredLabel(opts.tagged, opts.score === null ? null : opts.scannedCount);
  if (opts.score === null) return counts ? `no scans yet · ${counts}` : "no scans yet";
  return `${opts.postureLine} · ${counts}`;
}

export const TAGGED_COUNT_HINT =
  "Every repo tagged into this segment, watched or not, scanned or not. Distinct from scored counts on the cards and compare tiles.";

export const SCORED_COUNT_HINT =
  "Tagged is every repo added to this segment. Scored is how many have a scan. A missing score is not a zero.";
