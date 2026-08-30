import { Kicker } from "@/components/ui";
import { expectedLiftClause } from "@/lib/outcomes/expected-lift";
import { roadmapLiftKey, type RoadmapLifts } from "@/components/report/roadmapPriority";
import type { LlmRoadmapItem } from "@/lib/types";

/**
 * The measured basis under a roadmap row (moonshot #9): what this org has actually OBSERVED when this
 * gap was closed, with the evidence that licenses the number attached to it.
 *
 * Renders NOTHING when there is no publishable distribution — not "no data yet", not "+0", not a
 * greyed placeholder. An absent clause is the honest state for the overwhelming majority of gaps, and
 * a row that stays quiet about it reads as a roadmap; a row that says "no measured lift" reads as a
 * finding nobody made. The one-line clause is produced whole by `expectedLiftClause`, which is the
 * only way to obtain the median at all — so a number can never appear here without its `n` and its
 * instrument.
 *
 * Pure presentational (no hooks, no browser APIs), so it renders inside the server RoadmapSteps and
 * the client RecommendationTracker alike.
 */
export function ExpectedLiftBasis({
  item,
  lifts,
  className,
}: {
  item: Pick<LlmRoadmapItem, "dimension" | "title">;
  lifts: RoadmapLifts;
  className?: string;
}) {
  const clause = expectedLiftClause(lifts?.get(roadmapLiftKey(item)));
  if (!clause) return null;
  return (
    <div className={className ?? "mt-2 flex flex-wrap items-center gap-2 type-body-sm text-slate-400"}>
      <Kicker as="span" tone="muted">
        measured
      </Kicker>
      <span title="What this organization observed the last times this gap was closed, under the named instrument">
        {clause}
      </span>
    </div>
  );
}
