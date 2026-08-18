// The verdict classifier for the /delivery AI model — the thresholds and the one function that turns
// a repo's adoption/governance/spend into a Verdict. Split out of aiDeliveryModel.ts (200-line cap);
// the builder is its only caller.

import type { Verdict } from "./aiDeliveryTypes";

// Classification thresholds (tunable). Adoption = aiInvolvedRate; governance = aiGovernedRate.
const ADOPT_HI = 15; // ≥ this % of PRs AI-involved reads as "meaningfully adopted"
const GOV_HI = 60; // ≥ this % of AI PRs reviewed reads as "governed"
const SPEND_MEANINGFUL = 500; // $/mo above which paying-but-not-adopting reads as idle waste

// `spendReal` = a connected provider actually reports COST (measured|allocated). The two
// SPEND-DERIVED verdicts — `shadow` (adopted but no assigned plan) and `idle` (paying with little AI
// reaching PRs) — are only honest judgments when spend is real; with no cost source there are no
// dollars to reason about at all, so we fall through to the git-derived verdicts instead
// (adopted → ungoverned/working by real governance; not-adopted → starter). Adoption & governance are
// always real (git), so ungoverned/working/starter never depend on `spendReal`.
export function classify(
  r: { aiInvolvedRate: number; governedRate: number | null; planned: boolean; monthlySpend: number },
  spendReal: boolean,
): Verdict {
  const adopted = r.aiInvolvedRate >= ADOPT_HI;
  if (adopted && spendReal && !r.planned) return "shadow"; // AI in the work, no assigned plan
  if (adopted && r.governedRate != null && r.governedRate < GOV_HI) return "ungoverned";
  if (adopted) return "working"; // governed (or too small a sample to fault)
  // Not meaningfully adopted: paying real money for it anyway = idle waste; otherwise just early.
  if (spendReal && r.monthlySpend >= SPEND_MEANINGFUL) return "idle";
  return "starter";
}

export const VERDICT_ORDER: Verdict[] = ["ungoverned", "shadow", "idle", "working", "starter"];
