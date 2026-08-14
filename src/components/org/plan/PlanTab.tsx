// Org dashboard "Plan" tab — the management layer over the fleet: maturity goals (with live
// progress), the what-if simulator (project a fix before committing the work), tracked initiatives
// (started from the highest-leverage fleet moves), and the calibration detector backlog (the LLM
// auditor's suspected detector misses, aggregated — the loop that keeps the scoring honest).
//
// SERVER component, filename PINNED as PlanTab.tsx (docs/ORG-TABS-REFACTOR.md). Takes `slug` as a
// prop instead of reading route params — it is no longer a route. Three independent data sources,
// three <Suspense> boundaries: the gap decomposition (its own read), the core Goals/Simulator/
// Initiatives group (one shared read — see PlanCorePanel), and the detector backlog (its own read).
// None of the three blocks the others.
//
// `src/lib/scoring/orgsim.ts` is the Simulator's engine and is out of scope for this migration.

import { Suspense } from "react";
import { SectionHeader } from "@/components/org/shared/ui";
import { PlanGapPanel } from "@/components/org/plan/PlanGapPanel";
import { PlanCorePanel } from "@/components/org/plan/PlanCorePanel";
import { PlanDetectorBacklogPanel } from "@/components/org/plan/PlanDetectorBacklogPanel";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";

export function PlanTab({ slug }: { slug: string }) {
  return (
    <div className="stagger-children space-y-6">
      <SectionHeader
        descriptionClassName="max-w-3xl"
        title="Plan"
        description="From insight to plan: set targets, simulate the impact of a fix across the fleet, and track the work. The calibration backlog keeps the score honest."
      />

      {/* The call that precedes every target below: is the weakness the fleet's or one repo's? */}
      <Suspense fallback={<OrgTabGap minH="min-h-[16rem]" />}>
        <PlanGapPanel slug={slug} />
      </Suspense>

      <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
        <PlanCorePanel slug={slug} />
      </Suspense>

      <Suspense fallback={<OrgTabGap minH="min-h-[16rem]" />}>
        <PlanDetectorBacklogPanel slug={slug} />
      </Suspense>
    </div>
  );
}
