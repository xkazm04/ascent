// "Where AI spend goes, what it produces, and whether that work gets reviewed" — the sentence that
// used to head the AI delivery module — expressed as the three-stage chain it always described.
//
// Two stages can go VOID, and each void is a different absence the reader must not confuse with zero:
//   • spend, when no connected provider reports cost (`fidelity === "none"`). There is no spend
//     layer; the money is not zero, it is unmeasured.
//   • reviewed, when no AI PR sample cleared the floor (`governedAiShare === null`). Nothing is known
//     about review coverage — which is emphatically not "none of it was reviewed".
// `FlowRibbon` breaks the connectors at either, so the chain visibly does not join through a claim
// nobody measured.

import type { FlowStage } from "@/components/org/viz";
import type { AiDeliveryModel } from "./aiDeliveryModel";

export function aiDeliveryStages(model: AiDeliveryModel): FlowStage[] {
  const s = model.summary;
  const spend = model.fidelity === "none" ? null : s.totalMonthlySpend;
  const reviewed = s.governedAiShare == null ? null : Math.round((s.totalAiPRs * s.governedAiShare) / 100);
  return [
    // "(USD/mo)" in the label, not a unit suffix: FlowRibbon appends `unit` after the figure.
    { id: "spend", label: "Spend (USD/mo)", value: spend, state: spend === null ? "missing" : "measured" },
    { id: "output", label: "AI PRs", value: s.totalAiPRs, state: "measured" },
    { id: "reviewed", label: "Reviewed", value: reviewed, state: reviewed === null ? "missing" : "measured" },
  ];
}
