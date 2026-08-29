// The five verbs of the operating loop, shared by every "The loop" variant on /about-org.
//
// Hoisted out of the section component the moment a second variant needed the same content: the
// steps are the section's ARGUMENT, and two copies of an argument drift. Each step names the module
// that owns it and links into that module's real view in the demo org — same contract the questions
// ledger keeps, so every claim on this page is one click from being falsified.

import { orgTabHref, type OrgTabId } from "@/lib/org/orgTabs";
import { DEMO_ORG_SLUG } from "@/lib/site";

export interface LoopStep {
  /** Printed ordinal, "01".."05". */
  n: string;
  title: string;
  detail: string;
  /** The org-nav module group that owns this step. */
  module: string;
  tab: OrgTabId;
  /** Deep link into the demo org's real view for this step. */
  href: string;
}

const RAW: Array<Omit<LoopStep, "n" | "href">> = [
  {
    title: "Connect",
    detail: "Install the GitHub App on the org. Ascent reads through the API; it never clones your code.",
    module: "Govern",
    tab: "settings",
  },
  {
    title: "Scan",
    detail: "Every watched repository is scored across the nine dimensions, then rescanned on a cadence you set.",
    module: "Fleet",
    tab: "repositories",
  },
  {
    title: "Read",
    detail: "The rollup says where the fleet stands, what moved, and which gaps are shared across teams.",
    module: "Overview",
    tab: "overview",
  },
  {
    title: "Decide",
    detail:
      "The org-wide gaps — open in half the fleet — are practices to fix once; the ledger marks them so a batch is the right shape.",
    module: "Standing",
    tab: "followups",
  },
  {
    title: "Apply",
    detail: "Tick a batch, get one fix prompt for your local agent, hand it off; the next scan closes what landed.",
    module: "Standing",
    tab: "followups",
  },
];

export const LOOP_STEPS: LoopStep[] = RAW.map((s, i) => ({
  ...s,
  n: String(i + 1).padStart(2, "0"),
  href: orgTabHref(DEMO_ORG_SLUG, s.tab),
}));

/**
 * The step the loop returns to — index 1 ("Scan"), not 0. Connecting happens once; measuring happens
 * every cycle, which is the whole reason this is drawn as a loop rather than a funnel. Every variant
 * reads the return edge from here so none of them can point the arrow at a different stop.
 */
export const LOOP_RETURN_INDEX = 1;
