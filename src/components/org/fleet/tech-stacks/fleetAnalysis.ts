// Pure fleet-analysis for the tech-stacks section — turns the per-stack dimension averages into
// cross-stack INSIGHT: for every dimension, where the stacks agree (a shared strength), where they're
// all weak (a systemic gap), and where they diverge (an uneven capability one stack could transfer to
// the others). This is the content the old one-line "signals" couldn't express. Server-safe, no deps
// beyond the score labels, and unit-tested (fleetAnalysis.test.ts) since the thresholds are load-bearing.

import type { SegmentSummary } from "@/lib/db";
import { DIMENSION_SHORT } from "@/lib/ui";
import { orgTabHref } from "@/lib/org/orgTabs";

export type DimClass = "divergent" | "gap" | "strength" | "consistent";

// Thresholds (0..100 maturity scale). A dimension is DIVERGENT when the best- and worst-scoring stack
// are far apart (practice hasn't spread); a GAP when even the best stack is weak (fleet-wide deficit);
// a STRENGTH when even the worst stack is strong; otherwise CONSISTENT (clustered mid-range).
const DIVERGENT_SPREAD = 35;
const GAP_MAX = 45;
const STRENGTH_MIN = 68;

export interface DimEndpoint {
  id: string;
  name: string;
  value: number;
}

export interface DimInsight {
  dimId: string;
  label: string;
  min: number;
  max: number;
  mean: number;
  spread: number;
  /** Whole-fleet average for this dimension, or null when unknown. */
  fleet: number | null;
  leader: DimEndpoint;
  laggard: DimEndpoint;
  klass: DimClass;
  /** How many scored stacks contributed (coverage of the comparison). */
  count: number;
  /** How many scored stacks the comparison had to draw on — the DENOMINATOR for `count`. Carried on
   *  every insight (not just on FleetInsights) so any surface holding a DimInsight can state what the
   *  verdict rests on without prop-drilling. `count` can be lower: a stack whose scans predate a
   *  dimension carries no average for it, so it simply doesn't vote. */
  scoredCount: number;
}

/** Below this share of the scored stacks, an insight is a minority read and its verdict is visually
 *  DE-WEIGHTED (never hidden or reclassified — see `coverageOf`). Presentational only: it is not one
 *  of the classification thresholds above and never changes a `DimClass`. */
const LOW_COVERAGE_RATIO = 0.6;

export type CoverageLevel = "full" | "partial" | "low";

/**
 * What a dimension verdict rests on. A "divergent" call drawn from 2 of 8 stacks and one drawn from
 * all 8 are the same shape on screen but not the same claim, so every surface rendering a verdict
 * renders this beside it. "full" = every scored stack voted; "low" = a minority did (< 60%), which the
 * UI de-weights; "partial" = in between. Pure, so both the chip and the de-weighting agree.
 */
export function coverageOf(d: Pick<DimInsight, "count" | "scoredCount">): {
  count: number;
  of: number;
  ratio: number;
  level: CoverageLevel;
} {
  const of = Math.max(d.scoredCount, d.count);
  const ratio = of > 0 ? d.count / of : 0;
  const level: CoverageLevel = d.count >= of ? "full" : ratio < LOW_COVERAGE_RATIO ? "low" : "partial";
  return { count: d.count, of, ratio, level };
}

export interface FleetInsights {
  /** Every dimension, sorted most-actionable first (divergences & gaps before strengths). */
  dims: DimInsight[];
  strengths: DimInsight[];
  gaps: DimInsight[];
  divergent: DimInsight[];
  /** Scored stacks the whole analysis draws on — the denominator behind every insight's `count`. */
  scoredCount: number;
  widest: DimInsight | null;
  weakest: DimInsight | null;
  /** Overall best-vs-worst stack, or null when all tie. */
  overall: { spread: number; leader: SegmentSummary; laggard: SegmentSummary } | null;
}

const shortOf = (id: string) => DIMENSION_SHORT[id as keyof typeof DIMENSION_SHORT] ?? id;

export function classifyDim(min: number, max: number): DimClass {
  if (max - min >= DIVERGENT_SPREAD) return "divergent";
  if (max <= GAP_MAX) return "gap";
  if (min >= STRENGTH_MIN) return "strength";
  return "consistent";
}

const RANK: Record<DimClass, number> = { divergent: 0, gap: 1, consistent: 2, strength: 3 };

/**
 * Fold the scored stacks + fleet baseline into per-dimension insights and fleet-level rollups. Returns
 * null when fewer than two stacks are scored (no cross-stack comparison to make).
 */
export function computeFleetInsights(
  stacks: SegmentSummary[],
  fleet: SegmentSummary | null,
  dims: string[],
): FleetInsights | null {
  const scored = stacks.filter((s) => s.scannedCount > 0 && s.dimAverages.length > 0);
  if (scored.length < 2) return null;

  const fleetById = new Map((fleet?.dimAverages ?? []).map((d) => [d.dimId, d.avg]));
  const insights: DimInsight[] = [];

  for (const dimId of dims) {
    const pts: DimEndpoint[] = scored
      .map((s) => ({ id: s.id ?? "", name: s.name, value: s.dimAverages.find((d) => d.dimId === dimId)?.avg }))
      .filter((p): p is DimEndpoint => p.value != null);
    if (pts.length < 2) continue;

    const values = pts.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    const leader = pts.reduce((m, p) => (p.value > m.value ? p : m));
    const laggard = pts.reduce((m, p) => (p.value < m.value ? p : m));
    insights.push({
      dimId,
      label: shortOf(dimId),
      min,
      max,
      mean,
      spread: max - min,
      fleet: fleetById.get(dimId) ?? null,
      leader,
      laggard,
      klass: classifyDim(min, max),
      count: pts.length,
      scoredCount: scored.length,
    });
  }

  const sorted = [...insights].sort((a, b) => {
    if (RANK[a.klass] !== RANK[b.klass]) return RANK[a.klass] - RANK[b.klass];
    if (a.klass === "gap") return a.mean - b.mean; // worst gap first
    if (a.klass === "strength") return b.mean - a.mean; // strongest strength first
    return b.spread - a.spread; // widest divergence / consistent first
  });

  const byOverall = [...scored].sort((a, b) => b.avgOverall - a.avgOverall);
  const leaderS = byOverall[0]!;
  const laggardS = byOverall[byOverall.length - 1]!;

  return {
    dims: sorted,
    strengths: sorted.filter((d) => d.klass === "strength"),
    gaps: sorted.filter((d) => d.klass === "gap"),
    divergent: sorted.filter((d) => d.klass === "divergent"),
    scoredCount: scored.length,
    widest: insights.reduce<DimInsight | null>((m, d) => (!m || d.spread > m.spread ? d : m), null),
    weakest: insights.reduce<DimInsight | null>((m, d) => (!m || d.mean < m.mean ? d : m), null),
    overall:
      leaderS.avgOverall === laggardS.avgOverall
        ? null
        : { spread: leaderS.avgOverall - laggardS.avgOverall, leader: leaderS, laggard: laggardS },
  };
}

/** Deep-link to the Compare panel with a given A/B pair loaded (the primary "act on this" followup). */
export function insightCompareHref(org: string, aId: string, bId: string): string {
  const base = orgTabHref(org, "tech-stacks");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}a=${encodeURIComponent(aId)}&b=${encodeURIComponent(bId)}#compare`;
}
