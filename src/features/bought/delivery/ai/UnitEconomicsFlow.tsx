// The headline of the unit-economics panel: the chain a unit of AI work travels, drawn.
//
// "What a unit of AI work costs: cost per session that produced code, and cost per merged
// AI-attributed change" was a sentence describing a three-stage flow. It is now the flow —
// spend → sessions that produced code → merged AI changes — with every one of the panel's three
// standing refusals moved into the drawing or onto a chip beside it:
//
//   • no cost source        → the money stage is a VOID and the ribbon BREAKS (E)
//   • "produced code" ≠ success rate  → `PRODUCED_HINT` on a WhyChip (D)
//   • cost per merged change is an ALLOCATION, not a per-PR price → `ALLOCATION_HINT` (D)
//
// Server-safe: `FlowRibbon`, `Legend` and `WhyChip` cross the client boundary themselves.

import { FlowRibbon, Legend, WhyChip } from "@/components/org/viz";
import { flowHasVoid, unitEconomicsStages, type UnitFlowInput } from "./unitFlowStages";

/** (D) The demoted "'Produced code' is not a success rate" paragraph. */
export const PRODUCED_HINT =
  "Produced code is not a success rate: a session with no commit is often a question, a code read or a debugging pass. The measure says what was observed and leaves the judgement to you.";

/** (D) The demoted "cost per merged AI change is an allocation, not a per-PR price" paragraph. */
export const ALLOCATION_HINT =
  "Cost per merged AI change is an allocation, not a per-PR price: the telemetry carries no pull-request id, so spend is divided across the AI-attributed changes that merged in the same repository and period.";

/** (D) The demoted "no provider reports cost, so the money columns are empty rather than estimated". */
export const NO_COST_HINT =
  "No connected provider reported cost for this period, so the money stage is empty rather than estimated — and the chain is broken there rather than joined through a zero.";

export function UnitEconomicsFlow({
  fleet,
  reposWithoutDenominator,
}: {
  fleet: UnitFlowInput;
  reposWithoutDenominator: number;
}) {
  const stages = unitEconomicsStages(fleet);
  const broken = flowHasVoid(stages);

  return (
    <div>
      <FlowRibbon stages={stages} title="A unit of AI work" />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Legend states={broken ? ["measured", "missing"] : ["measured"]} />
        <span className="flex items-center gap-1.5 type-mono-sm text-slate-600">
          produced code
          <WhyChip hint={PRODUCED_HINT} label="what produced code counts" />
        </span>
        <span className="flex items-center gap-1.5 type-mono-sm text-slate-600">
          allocation
          <WhyChip hint={ALLOCATION_HINT} label="how cost per merged change is derived" />
        </span>
        {broken && (
          <span className="flex items-center gap-1.5 type-mono-sm text-slate-600">
            no cost source
            <WhyChip hint={NO_COST_HINT} label="why the money stage is empty" />
          </span>
        )}
        {reposWithoutDenominator > 0 && (
          <span className="flex items-center gap-1.5 type-mono-sm text-amber-200/80">
            {reposWithoutDenominator} repo{reposWithoutDenominator === 1 ? "" : "s"} excluded
            <WhyChip
              hint={`${reposWithoutDenominator} ${reposWithoutDenominator === 1 ? "repository has" : "repositories have"} agent spend but no merged AI-attributed change in this window, so they have no denominator and are excluded from the per-merge ratio. Their spend is real and is included in the spend stage.`}
              label="excluded repositories"
              align="end"
            />
          </span>
        )}
      </div>
    </div>
  );
}
