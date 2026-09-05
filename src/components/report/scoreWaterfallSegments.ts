// Pure segment layout for ScoreWaterfall's stacked 0..100 track.
//
// The waterfall's whole claim is an identity: each dimension contributes `normalizedWeight × score`
// points, the segment widths ARE those point values as a percentage of a 100-point track, and the
// faint tail is the headroom left to 100. A per-segment PIXEL floor breaks that identity. The old
// `minWidth: "0.375rem"` on every non-zero contribution meant that with 9 dimensions the summed
// floors could exceed the container, so the flex line distorted the visible proportions and the
// trailing `flex-1` headroom tail collapsed to nothing — on exactly the low-scoring repos where the
// "how far am I from 100" story is the point of the chart.
//
// So: no floor. A contribution's width is its true share. Contributions too thin to draw honestly
// are instead AGGREGATED into one labeled neutral sliver whose width is their exact sum, and the
// itemized list below the track still names every dimension individually. `Σ points ≤ 100` always
// (points = normalizedWeight × score, Σ normalizedWeight = 1, score ≤ 100), so the track can no
// longer overflow and the headroom is always the honest remainder.

import { fmtPts } from "@/lib/ui";

/** The subset of a scoring-engine `DimensionContribution` this layout reads. */
export interface WaterfallContribution {
  dimension: string;
  name: string;
  score: number;
  points: number;
  normalizedWeight: number;
}

export interface WaterfallSegment {
  key: string;
  /** True width share of the 0..100 track, in points. */
  points: number;
  /** Score to color the fill from; `null` for the aggregated sliver (drawn neutral). */
  score: number | null;
  /** Hover title. */
  title: string;
  /** How many contributions this segment stands for — `> 1` only for the aggregate. */
  count: number;
}

/**
 * Contributions below this many points would render thinner than ~1.5% of the track. Drawing them
 * at a fixed pixel floor overstates them; drawing them at true width makes them invisible. Rolling
 * two or more of them into one sliver is the only option that neither lies nor hides.
 */
export const MICRO_POINTS = 1.5;

/** Neutral slate for the aggregated sliver — it stands for several scores, so it carries none. */
export const AGGREGATE_HEX = "#475569";

/**
 * Lay the ranked contributions out as track segments. Zero-point contributions (a 0-scoring
 * dimension) draw nothing at all — a zero contributes zero width, and the itemization below carries
 * its "+0.0". Order is preserved; the aggregate, being the smallest, sorts last.
 */
export function waterfallSegments(ranked: readonly WaterfallContribution[]): WaterfallSegment[] {
  const drawn = ranked.filter((c) => c.points > 0);
  const micro = drawn.filter((c) => c.points < MICRO_POINTS);
  // A lone micro contribution keeps its own identity (an "other" of one is just a worse label); it
  // renders at true width, thin but not fabricated. Two or more become the sliver.
  const aggregate = micro.length > 1;

  const segments: WaterfallSegment[] = [];
  for (const c of drawn) {
    if (aggregate && c.points < MICRO_POINTS) continue;
    segments.push({
      key: c.dimension,
      points: c.points,
      score: c.score,
      title: `${c.dimension} ${c.name}: ${c.score}/100 × ${Math.round(c.normalizedWeight * 100)}% weight = +${fmtPts(c.points)} pts`,
      count: 1,
    });
  }

  if (aggregate) {
    const sum = micro.reduce((acc, c) => acc + c.points, 0);
    segments.push({
      key: "__aggregate__",
      points: sum,
      score: null,
      title:
        `${micro.length} dimensions under ${fmtPts(MICRO_POINTS)} pts each: ` +
        `${micro.map((c) => `${c.dimension} +${fmtPts(c.points)}`).join(", ")} = +${fmtPts(sum)} pts`,
      count: micro.length,
    });
  }

  return segments;
}

/** Points left on the 100-point track. Never negative (Σ points ≤ 100), never inflated. */
export function waterfallHeadroom(total: number): number {
  return Math.max(0, 100 - total);
}
