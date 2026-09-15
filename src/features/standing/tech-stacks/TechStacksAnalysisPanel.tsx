// The stack maturity spread + the profiles/analysis board — the Tech Stacks tab's data region, under
// its own <Suspense> boundary because listTechStackSummaries is its own read.

import { DIMS } from "@/components/org/shared/ui";
import { StackSpreadStrip } from "./StackSpreadStrip";
import { TechStacksAnalysis } from "./TechStacksAnalysis";
import { orderStacks } from "./stackMeasure";
import { listTechStackSummaries } from "@/lib/db";

export async function TechStacksAnalysisPanel({ slug }: { slug: string }) {
  const summaries = (await listTechStackSummaries(slug, { includeFleet: true })) ?? [];

  // The whole-fleet baseline (id null) anchors the matrix; stacks rank leaderboard-style by overall
  // — but only the MEASURED ones. An unscanned stack's avgOverall is a sentinel 0, so sorting on the
  // number alone ranked it last as though it were the fleet's worst; `orderStacks` separates the two
  // groups so the tail of the rail reads "never scanned" rather than "bottom of the table".
  const fleet = summaries.find((s) => s.id === null) ?? null;
  const stacks = orderStacks(summaries.filter((s) => s.id !== null));

  return (
    <div className="space-y-4">
      <StackSpreadStrip stacks={stacks} />
      <TechStacksAnalysis org={slug} stacks={stacks} fleet={fleet} dims={DIMS} />
    </div>
  );
}
