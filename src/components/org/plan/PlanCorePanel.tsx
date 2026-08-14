// The Plan tab's core data region: Goals + the what-if Simulator (side by side) and tracked
// Initiatives below. Its own <Suspense> boundary in PlanTab — these three panels share one batch of
// reads (goals, initiatives, rollup, recommendations), so they're fetched together here rather than
// each re-querying, and stream independently of the gap-decomposition and detector-backlog panels
// beside them (docs/ORG-TABS-REFACTOR.md §2: one boundary per independent data source).

import { SectionEmpty } from "@/components/org/shared/ui";
import { GoalsPanel } from "@/components/org/plan/GoalsPanel";
import { ProgramPanel } from "@/components/org/plan/ProgramPanel";
import { Simulator } from "@/components/org/plan/Simulator";
import { InitiativesPanel } from "@/components/org/plan/InitiativesPanel";
import { computeGoalSuggestions, computeInitiativeSeeds, computeInitiativesByGoal, dimOptionsFrom, metricOptionsFrom } from "@/components/org/plan/planCoreData";
import { getOrgRecommendations, getOrgRollup, listGoals, listInitiatives, metricLabel } from "@/lib/db";
import { getOrgProgram } from "@/lib/db/org-program";

export async function PlanCorePanel({ slug }: { slug: string }) {
  // One parallel batch — Goals, the Simulator's dimension options, and Initiatives' seeded moves all
  // derive from the same rollup + recommendations, so they share this single read rather than each
  // panel re-querying it. The programme rides along (one indexed unique lookup, request-cached with
  // the shell's own read of it).
  const [goals, initiatives, rollup, recs, program] = await Promise.all([
    listGoals(slug),
    listInitiatives(slug),
    getOrgRollup(slug),
    getOrgRecommendations(slug),
    getOrgProgram(slug),
  ]);

  const scannedRepos = (rollup?.repos ?? []).filter((r) => r.latest);
  if (!rollup || scannedRepos.length === 0) {
    return <SectionEmpty>No scanned repositories yet. Scan some of this org&apos;s repos to plan against them.</SectionEmpty>;
  }

  const repoOptions = scannedRepos.map((r) => ({ fullName: r.fullName, name: r.name }));
  const nameToFull = new Map(scannedRepos.map((r) => [r.name, r.fullName]));
  const dimOptions = dimOptionsFrom(rollup);
  const metricOptions = metricOptionsFrom(metricLabel);

  const seeds = computeInitiativeSeeds(recs, nameToFull);
  const initiativesByGoal = computeInitiativesByGoal(initiatives);
  const goalSuggestions = computeGoalSuggestions(rollup, goals, dimOptions);

  return (
    <>
      {/* Above Goals on purpose: a goal is a number the fleet steers toward, the programme is the
          named, dated thing the org is doing — the frame those goals hang off. */}
      <ProgramPanel slug={slug} initial={program} />

      <div className="grid gap-6 lg:grid-cols-2">
        <GoalsPanel slug={slug} initial={goals ?? []} metricOptions={metricOptions} initiativesByGoal={initiativesByGoal} suggestions={goalSuggestions} />
        <Simulator slug={slug} dims={dimOptions} repos={repoOptions} />
      </div>

      <InitiativesPanel
        slug={slug}
        initial={initiatives ?? []}
        seeds={seeds}
        goals={(goals ?? []).map((g) => ({ id: g.id, label: g.label }))}
      />
    </>
  );
}
