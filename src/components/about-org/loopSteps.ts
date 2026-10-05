// The six stages of the operating loop, shared by every "The loop" variant on /about-org.
//
// A VIEW of the one declared journey (`ORG_STAGES`, src/lib/org/orgJourney.ts), not a second
// declaration of it: the step list, the order, the tab each step links to and the stop the loop
// returns to are all read from there, and the module label beside each step is read from the rail
// (`ORG_NAV_GROUPS`) by looking up the lane that holds the tab. Only the one-line `detail` copy is
// authored here, keyed by stage id. Every claim on this page stays one click from being falsified.

import { ORG_STAGES, type OrgStageId } from "@/lib/org/orgJourney";
import { orgTabHref, type OrgTabId } from "@/lib/org/orgTabs";
import { DEMO_ORG_SLUG } from "@/lib/site";
import { orgGroupLabelFor } from "./orgModules";

export interface LoopStep {
  /** Printed ordinal, "01".."06". */
  n: string;
  title: string;
  detail: string;
  /** The org-nav module group that owns this step's tab. */
  module: string;
  tab: OrgTabId;
  /** Deep link into the demo org's real view for this step. */
  href: string;
}

const DETAIL: Record<OrgStageId, string> = {
  connect:
    "Map your AI registry repo and install the GitHub App. Ascent reads through the API; it never clones your code.",
  scan: "Every watched repository is scored across the nine dimensions, then rescanned on a cadence you set.",
  read: "The rollup says where the fleet stands, what moved, and which gaps are shared across teams.",
  decide:
    "The org-wide gaps, open in half the fleet, are practices to fix once; the ledger marks them so a batch is the right shape.",
  apply:
    "The live loop turns a decision into commits on your repositories; the next scan closes what landed.",
  measure:
    "The Briefing reads what the cycle delivered, and the next read starts from it.",
};

export const LOOP_STEPS: LoopStep[] = ORG_STAGES.map((stage, i) => {
  const lane = orgGroupLabelFor(stage.entryTab);
  if (!lane) throw new Error(`loopSteps: ${stage.id} enters on ${stage.entryTab}, which is not a rail tab`);
  return {
    n: String(i + 1).padStart(2, "0"),
    title: stage.label,
    detail: DETAIL[stage.id],
    module: lane,
    tab: stage.entryTab,
    href: orgTabHref(DEMO_ORG_SLUG, stage.entryTab),
  };
});

/**
 * The step the loop returns to: Read, not Connect or Scan. Connecting and the first scan happen once;
 * reading, deciding, applying and measuring happen every cycle, which is the whole reason this is
 * drawn as a loop rather than a funnel. Derived from the journey so no variant can point the arrow at a
 * different stop.
 */
export const LOOP_RETURN_INDEX = ORG_STAGES.findIndex((s) => s.id === "read");
