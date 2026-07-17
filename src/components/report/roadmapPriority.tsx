import type { Effort, LlmRoadmapItem } from "@/lib/types";
import { IMPACT_RANK } from "@/lib/scoring/impact";

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

/** High impact that isn't high effort — the emerald "⚡ Quick win" call-out. */
export const isQuickWin = (it: Pick<LlmRoadmapItem, "impact" | "effort">) =>
  it.impact === "high" && it.effort !== "high";

/** The shared quick-win badge, identical on the public roadmap and the persisted tracker. */
export function QuickWinBadge() {
  return (
    <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-sm font-semibold uppercase tracking-widest text-emerald-300">
      ⚡ Quick win
    </span>
  );
}
