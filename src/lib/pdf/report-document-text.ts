// Length caps and roadmap ordering for the paid PDF. Kept out of report-document.tsx so that file
// stays under the 300-LOC .tsx cap while the G9 engine caveat lives in the body.

import type { LlmRoadmapItem } from "@/lib/types";
import { IMPACT_RANK } from "@/lib/scoring/impact";

export const MAX_DIM_SUMMARY_CHARS = 320;
export const MAX_ROADMAP_RATIONALE_CHARS = 280;
export const MAX_ROADMAP_FIRST_STEP_CHARS = 220;

// A verbose LLM-generated string dropped into a `wrap={false}` block can exceed a page's remaining
// height (G5-08/G5-09) — @react-pdf's handling of an unsplittable block taller than the page is
// inconsistent (clip / overlap / blank page). Cap length defensively rather than trust the model.
export function truncateText(s: string, max: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/** Quick-wins-first ordering for the PDF roadmap — same impact-dominates/effort-tiebreak contract as
 *  the in-app roadmap (roadmapPriority.tsx), reimplemented locally: that module lives under
 *  src/components/report/, out of scope for this file's edit. */
export function roadmapPriority(item: Pick<LlmRoadmapItem, "impact" | "effort">): number {
  const effortRank: Record<string, number> = { low: 1, medium: 2, high: 3 };
  return (IMPACT_RANK[item.impact] ?? 0) * 10 - (effortRank[item.effort] ?? 0);
}
