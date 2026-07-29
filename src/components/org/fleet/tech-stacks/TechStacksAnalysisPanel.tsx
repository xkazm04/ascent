// The stack × dimension heat matrix + playbooks — the Tech Stacks tab's first data region. Its own
// <Suspense> boundary because listTechStackSummaries is a separate read from the A/B comparison below.

import { DIMS } from "@/components/org/shared/ui";
import { TechStacksAnalysis } from "./TechStacksAnalysis";
import { listTechStackSummaries } from "@/lib/db";

export async function TechStacksAnalysisPanel({ slug }: { slug: string }) {
  const summaries = (await listTechStackSummaries(slug, { includeFleet: true })) ?? [];

  // The whole-fleet baseline (id null) anchors the matrix; stacks rank leaderboard-style by overall.
  const fleet = summaries.find((s) => s.id === null) ?? null;
  const stacks = summaries.filter((s) => s.id !== null).sort((x, y) => y.avgOverall - x.avgOverall);

  return <TechStacksAnalysis org={slug} stacks={stacks} fleet={fleet} dims={DIMS} />;
}
