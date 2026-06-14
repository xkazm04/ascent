// The "Plan" tab — the management layer over the fleet: maturity goals (with live progress), the
// what-if simulator (project a fix before committing the work), tracked initiatives (started from
// the highest-leverage fleet moves), and the calibration detector backlog (the LLM auditor's
// suspected detector misses, aggregated — the loop that keeps the scoring honest).

import { Card, SectionEmpty, SectionHeader } from "@/components/org/ui";
import { GoalsPanel } from "@/components/org/plan/GoalsPanel";
import { Simulator } from "@/components/org/plan/Simulator";
import { InitiativesPanel } from "@/components/org/plan/InitiativesPanel";
import {
  getOrgDiscrepancies,
  getOrgRecommendations,
  getOrgRollup,
  listGoals,
  listInitiatives,
} from "@/lib/db";
import { DIMENSIONS, DIMENSION_BY_ID } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function OrgPlan({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [goals, initiatives, rollup, recs, discrepancies] = await Promise.all([
    listGoals(slug),
    listInitiatives(slug),
    getOrgRollup(slug),
    getOrgRecommendations(slug),
    getOrgDiscrepancies(slug),
  ]);

  const scannedRepos = (rollup?.repos ?? []).filter((r) => r.latest);
  const repoOptions = scannedRepos.map((r) => ({ fullName: r.fullName, name: r.name }));
  const nameToFull = new Map(scannedRepos.map((r) => [r.name, r.fullName]));

  const dimAvg = new Map((rollup?.dimAverages ?? []).map((d) => [d.dimId, d.avg]));
  const dimOptions = DIMENSIONS.map((d) => ({ id: d.id, label: d.name, avg: dimAvg.get(d.id) ?? 0 }));

  const metricOptions = [
    { value: "overall", label: "Overall maturity" },
    { value: "adoption", label: "AI Adoption" },
    { value: "rigor", label: "Engineering Rigor" },
    ...DIMENSIONS.map((d) => ({ value: d.id, label: `${d.id} · ${d.name}` })),
  ];

  // Seed initiatives from the highest-leverage fleet moves; map the rec's repo *names* to
  // fullNames (initiatives track fullNames so progress can match the latest scans).
  const seeds = (recs ?? []).map((r) => ({
    title: r.title,
    dimId: r.dimId,
    dimLabel: DIMENSION_BY_ID[r.dimId as DimensionId]?.name ?? r.dimId,
    repos: r.repos.map((n) => nameToFull.get(n)).filter((x): x is string => !!x),
    repoCount: r.repoCount,
  }));

  // GOAL-6: cross-render — group the initiatives linked to each goal so a goal shows its plan.
  const initiativesByGoal: Record<string, { id: string; title: string; status: string }[]> = {};
  for (const i of initiatives ?? []) {
    if (!i.goalId) continue;
    (initiativesByGoal[i.goalId] ||= []).push({ id: i.id, title: i.title, status: i.status });
  }

  if (!rollup || scannedRepos.length === 0) {
    return <SectionEmpty>No scanned repositories yet — scan some of this org&apos;s repos to plan against them.</SectionEmpty>;
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        descriptionClassName="max-w-3xl"
        title="Plan"
        description="From insight to plan — set targets, simulate the impact of a fix across the fleet, and track the work. The calibration backlog keeps the score honest."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <GoalsPanel slug={slug} initial={goals ?? []} metricOptions={metricOptions} initiativesByGoal={initiativesByGoal} />
        <Simulator slug={slug} dims={dimOptions} repos={repoOptions} />
      </div>

      <InitiativesPanel
        slug={slug}
        initial={initiatives ?? []}
        seeds={seeds}
        goals={(goals ?? []).map((g) => ({ id: g.id, label: g.label }))}
      />

      {/* Calibration: the LLM-as-auditor detector backlog. */}
      <Card>
        <SectionHeader
          size="sm"
          title="Detector backlog"
          description="Where the scan's LLM auditor suspects the deterministic detectors missed something — a prioritized list of calibration work."
        />
        {!discrepancies || discrepancies.total === 0 ? (
          <p className="mt-4 text-base text-slate-500">
            No flagged detector misses across {discrepancies?.scanned ?? 0} scanned repos — the auditor and the detectors agree.
          </p>
        ) : (
          <>
            <p className="mt-2 font-mono text-sm text-slate-500">
              {discrepancies.total} flags across {discrepancies.flaggedRepos}/{discrepancies.scanned} repos
            </p>
            <div className="mt-3 space-y-3">
              {discrepancies.groups.map((g) => (
                <div key={g.dimId} className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-base font-medium text-white">
                      {g.dimId} · {g.label}
                    </div>
                    <span className="font-mono text-sm text-amber-300">
                      {g.count} flag{g.count === 1 ? "" : "s"} · {g.repos.length} repo{g.repos.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {g.examples.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-slate-400">
                      {g.examples.map((e, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="select-none text-slate-600">·</span>
                          <span>{e}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
