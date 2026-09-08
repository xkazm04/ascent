// The three stages of a unit of AI work — spend → sessions that produced code → merged AI changes —
// as `FlowRibbon` input. Pure, so the one invariant that matters here is unit-testable.
//
// THE INVARIANT. When no connected provider reports cost, the money stage is `missing`: a VOID that
// BREAKS the ribbon. Never an estimate, never a zero. The integrations copy has always said "until a
// provider that reports cost is connected, the money columns are empty rather than estimated" — that
// sentence is now the shape's behaviour rather than a promise made beside it, and `FlowRibbon`
// enforces it by refusing to draw the connectors either side of a void stage.
//
// A zeroed money stage would be the worst available drawing: it would render a legible, proportional
// "we spent nothing" chain, which is a claim about the org's spend rather than an admission that
// nothing measured it.

import type { FlowStage } from "@/components/org/viz";

export interface UnitFlowInput {
  sessions: number;
  producedCode: number;
  costCents: number;
  mergedAiChanges: number;
}

/** Dollars, rounded — the ribbon's stage labels are read at a glance, not reconciled to the cent. */
export function dollars(cents: number): number {
  return Math.round(cents / 100);
}

export function unitEconomicsStages(f: UnitFlowInput): FlowStage[] {
  // costCents === 0 with sessions recorded is not "free": it is the absence of a cost source. The
  // agent sessions were observed; nobody priced them.
  const spend = f.costCents > 0 ? dollars(f.costCents) : null;
  return [
    // "(USD)" in the label rather than a "$" unit: FlowRibbon appends `unit` AFTER the figure, so a
    // currency marker can only live in the stage's name without printing "1,240$".
    { id: "spend", label: "Spend (USD)", value: spend, state: spend === null ? "missing" : "measured" },
    { id: "produced", label: "Produced code", value: f.producedCode, state: "measured" },
    { id: "merged", label: "Merged AI", value: f.mergedAiChanges, state: "measured" },
  ];
}

/** True when the ribbon will be broken — the legend then shows the void row. */
export function flowHasVoid(stages: FlowStage[]): boolean {
  return stages.some((s) => s.value === null || s.state === "missing");
}
