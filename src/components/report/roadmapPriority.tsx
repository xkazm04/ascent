import type { Effort, LlmRoadmapItem } from "@/lib/types";
import { IMPACT_RANK } from "@/lib/scoring/impact";
import type { LiftDistribution } from "@/lib/outcomes/aggregate";
import { measuredRank } from "@/lib/outcomes/expected-lift";
import { recommendationMatchKey } from "@/lib/report/rec-identity";

// The roadmap's single prioritization contract, shared by BOTH renderings of "Gaps to explore":
// RoadmapSteps (public/anonymous scans) and RecommendationTracker (persisted scans). It lives in its
// own module — not roadmapPieces — so the tracker (whose tests stub roadmapPieces' presentational
// chips) gets the real ordering logic, and so the two surfaces can never drift apart again
// (enabling persistence used to silently drop the priority sort + quick-win signal —
// roadmap-recommendation-tracking #2).

const EFFORT_RANK: Record<Effort, number> = { low: 1, medium: 2, high: 3 };

/** Quick-wins-first ordering: impact dominates (×10), effort breaks ties (cheaper first). */
export const priorityScore = (it: Pick<LlmRoadmapItem, "impact" | "effort">) =>
  (IMPACT_RANK[it.impact] ?? 0) * 10 - EFFORT_RANK[it.effort];

// ── Measured ordering (moonshot #9) ──────────────────────────────────────────────────────────────

/** How a roadmap is ordered. `priority` is the long-standing default and is unchanged. */
export type RoadmapSortMode = "priority" | "measured";

/** The lift map `expected-lift-load` builds, keyed by `recommendationMatchKey(dimension, title)`. */
export type RoadmapLifts = ReadonlyMap<string, LiftDistribution> | null | undefined;

/**
 * The most a measured median may move an item. Deliberately BELOW one impact rank (10), and that
 * bound is the design, not a tuning constant:
 *
 * measurement re-orders items INSIDE the model's impact judgment — it breaks effort ties and lifts a
 * gap that demonstrably moved the score above one that demonstrably did not — but it can never carry
 * an item across a full impact band. So an unmeasured high-impact gap is never buried beneath a
 * measured low-impact one, which is the failure a naive "sort by measured lift" produces the moment a
 * ledger has three rows about one trivial gap and nothing about anything else.
 */
export const MEASURED_BOOST_CAP = 8;

/** Points of boost per point of median lift. Half, so a +16 median is needed to spend the whole cap. */
export const MEASURED_WEIGHT = 0.5;

/** The identity a rendered roadmap item computes for itself, to look up its measured distribution. */
export const roadmapLiftKey = (it: Pick<LlmRoadmapItem, "dimension" | "title">) =>
  recommendationMatchKey(it.dimension, it.title);

/**
 * `priorityScore` adjusted by what the org has actually MEASURED about this gap — or exactly
 * `priorityScore` when there is nothing measured, which is the G4 half: no evidence must degrade to
 * the model's own ordering, never to a fabricated zero that sinks the item.
 */
export function measuredPriorityScore(
  it: Pick<LlmRoadmapItem, "impact" | "effort" | "dimension" | "title">,
  lifts: RoadmapLifts,
): number {
  const base = priorityScore(it);
  const rank = measuredRank(lifts?.get(roadmapLiftKey(it)));
  if (rank === null) return base;
  const boost = Math.max(-MEASURED_BOOST_CAP, Math.min(MEASURED_BOOST_CAP, rank * MEASURED_WEIGHT));
  return base + boost;
}

/**
 * The roadmap's ordering, in one place for both renderings. `mode: "priority"` is byte-identical to
 * the sort both surfaces have always done. `mode: "measured"` adds the capped measured adjustment
 * above — so with an empty ledger it returns the SAME order as `"priority"`, by construction rather
 * than by coincidence.
 */
export function sortRoadmap<T extends Pick<LlmRoadmapItem, "impact" | "effort" | "dimension" | "title">>(
  items: readonly T[],
  lifts: RoadmapLifts,
  mode: RoadmapSortMode = "priority",
): T[] {
  const score = mode === "measured" ? (it: T) => measuredPriorityScore(it, lifts) : priorityScore;
  return [...items].sort((a, b) => score(b) - score(a));
}

/** High impact that isn't high effort — the emerald "⚡ Quick win" call-out. */
export const isQuickWin = (it: Pick<LlmRoadmapItem, "impact" | "effort">) =>
  it.impact === "high" && it.effort !== "high";

/** The shared quick-win badge, identical on the public roadmap and the persisted tracker. */
export function QuickWinBadge() {
  return (
    <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 type-body-sm font-semibold uppercase tracking-widest text-emerald-300">
      ⚡ Quick win
    </span>
  );
}
