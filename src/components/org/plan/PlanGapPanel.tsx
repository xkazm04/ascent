// Thin async wrapper for the gap-decomposition read — its own <Suspense> boundary in PlanTab so this
// one query (getOrgGapAnalysis) can't hold up the core Goals/Simulator/Initiatives panel or the
// detector backlog beside it.

import { GapDecompositionPanel } from "@/components/org/plan/GapDecompositionPanel";
import { getOrgGapAnalysis } from "@/lib/db";

export async function PlanGapPanel({ slug }: { slug: string }) {
  const analysis = await getOrgGapAnalysis(slug);
  return <GapDecompositionPanel slug={slug} analysis={analysis} />;
}
