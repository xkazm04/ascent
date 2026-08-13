"use client";

import { Card, SectionHeader } from "@/components/org/shared/ui";
import type { DimOption, RepoOption } from "@/components/org/plan/SimulatorTypes";
import { RankPanel } from "@/components/org/plan/SimulatorRankPanel";
import { ProjectionResult } from "@/components/org/plan/SimulatorProjectionResult";
import { SavedScenarios } from "@/components/org/plan/SimulatorSavedScenarios";
import { ScenarioForm } from "@/components/org/plan/SimulatorScenarioForm";
import { useSimulator } from "@/components/org/plan/useSimulator";

/** What-if: project the fleet impact of raising a dimension to a target across a repo set. All
 *  state/handlers live in `useSimulator` — this file is JSX only (200-LOC cap). */
export function Simulator({ slug, dims, repos }: { slug: string; dims: DimOption[]; repos: RepoOption[] }) {
  const sim = useSimulator({ slug, dims });

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="What-if simulator"
        description="Project the fleet impact of landing a fix before you commit the work."
      />

      {/* SIM-3: let the engine rank where to invest, instead of guessing the dimension. */}
      <RankPanel
        ranking={sim.ranking}
        rankBusy={sim.rankBusy}
        rankError={sim.rankError}
        target={sim.target}
        stale={sim.rankingStale}
        staleNote={sim.rankingStale && sim.rankedWith ? `computed for ${sim.rankedScopeLabel} at target ${sim.rankedWith.target}` : null}
        onSuggest={sim.suggestMoves}
        onLoadMove={sim.loadMove}
      />

      {/* Scenario inputs: primary leg, SIM-2 extra legs, and the repo scope picker. */}
      <ScenarioForm
        dims={dims}
        repos={repos}
        dimId={sim.dimId}
        target={sim.target}
        extras={sim.extras}
        used={sim.used}
        scope={sim.scope}
        showRepos={sim.showRepos}
        scopeLabel={sim.scopeLabel}
        busy={sim.busy}
        invalidate={sim.invalidate}
        setDimId={sim.setDimId}
        setTarget={sim.setTarget}
        setScope={sim.setScope}
        setShowRepos={sim.setShowRepos}
        toggle={sim.toggle}
        updateExtra={sim.updateExtra}
        removeExtra={sim.removeExtra}
        addDimension={sim.addDimension}
        run={sim.run}
      />

      {/* role="status": a screen-reader user who clicked Simulate must HEAR the failure — a plain <p>
          inserted after the fact announces nothing (investment 07-16 #5). */}
      {sim.error && <p role="status" className="mt-3 text-sm text-orange-300">{sim.error}</p>}

      {sim.result && (
        <ProjectionResult
          result={sim.result}
          goalImpacts={sim.goalImpacts}
          tracking={sim.tracking}
          tracked={sim.tracked}
          trackError={sim.trackError}
          onTrack={sim.trackAsInitiative}
          onSave={sim.saveScenario}
        />
      )}

      {/* SIM-5: saved scenarios + a 2-up compare (client-only scratchpad). */}
      {sim.saved.length > 0 && (
        <SavedScenarios
          slug={slug}
          dims={dims}
          saved={sim.saved}
          compare={sim.compare}
          comparing={sim.comparing}
          onToggleCompare={sim.toggleCompare}
          onRemove={(id) => sim.setSaved((xs) => xs.filter((x) => x.id !== id))}
        />
      )}
    </Card>
  );
}
