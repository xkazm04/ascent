// The three org-only capabilities /about-org goes deep on, in narrative order.
//
// Chosen to NOT overlap /about (src/components/about/features.ts), which already sells the fleet
// X-ray, the ROI simulator, adoption and risk. Two marketing pages that make the same four arguments
// give a reader no reason to read the second one. These three are the muscle a per-repo tool cannot
// have at all: fleet-wide application, institutional knowledge, and governance evidence.
//
// Same shape as ABOUT_FEATURES so both decks can render through the shared AboutFeature section.

import { PRACTICES } from "@/lib/practices";
import { orgGroupLabelFor } from "./orgModules";
import type { OrgTabId } from "@/lib/org/orgTabs";
import type { AnchoredFeature, ClaimAnchor } from "@/components/about/claimAnchors";

export type AboutOrgFeatureId = "practices" | "knowledge" | "governance";

interface AboutOrgFeatureData extends AnchoredFeature {
  id: AboutOrgFeatureId;
  kicker: string;
  title: string;
  body: string;
  points: string[];
  /** The money line — the one-sentence takeaway. */
  value: string;
}

/** How a feature is WRITTEN: it names the tab it lives in, and the module half of the kicker is
 *  derived from that. The three kickers used to read "Plan ·", "Library ·" and "Govern ·" — module
 *  names from an information architecture the rail retired. `orgGroupLabelFor` reads the shipping
 *  groups, so the next regroup renames the copy instead of stranding it. */
interface AboutOrgFeatureSpec extends Omit<AboutOrgFeatureData, "kicker" | "points" | "anchors"> {
  /** The tab this capability lives in — the source of the kicker's module name. */
  tab: OrgTabId;
  /** The half of the kicker that is editorial: what the capability IS, after the module name. */
  kickerSuffix: string;
  /** The tabs the body's claims rest on (the claim gate, src/components/about/claimAnchors.ts). */
  bodyAnchors: ClaimAnchor[];
  /** Each point is written beside the capability it rests on, so the pair cannot drift apart. */
  points: { text: string; anchors: ClaimAnchor[] }[];
}

const at = (...ids: OrgTabId[]): ClaimAnchor[] => ids.map((tab) => ({ tab }));

const SPECS: AboutOrgFeatureSpec[] = [
  {
    id: "practices",
    tab: "practices",
    kickerSuffix: "the practice library",
    bodyAnchors: at("practices"),
    title: "Fix it once. Apply it across the fleet.",
    body: "A practice turns a finding into an artifact: Ascent scaffolds a starter file tailored to the target repo's language (a CI workflow, an AGENTS.md, an ADR template) and opens it as a draft pull request your team reviews and merges. One authored practice can be applied to a batch of repositories in a single action instead of being re-explained team by team.",
    points: [
      // The count comes from the library itself (src/lib/practices.ts), not from a word typed here.
      {
        text: `${PRACTICES.length} practices, one per scored dimension, generated deterministically: no LLM, no keys, no leaked repo detail`,
        anchors: at("practices"),
      },
      { text: "Batch apply opens draft PRs across up to 25 repositories per run", anchors: at("practices") },
      // Was "The backlog carries every remaining gap with an owner and a due date ... exportable as
      // CSV": the Backlog tab retired 2026-08-17 for the ledger that is now Proposals.
      {
        text: "The Proposals ledger keeps every remaining gap in one place: tick a batch, hand off one fix prompt, and the next scan closes what landed",
        anchors: at("proposals"),
      },
    ],
    value: "The gap analysis stops being a slide and starts being a set of open pull requests.",
  },
  {
    id: "knowledge",
    tab: "memory",
    kickerSuffix: "memory & skills",
    bodyAnchors: at("memory", "skills"),
    title: "Institutional memory that outlives the org chart",
    body: "Shared Org Memory is a durable store of what happened, what is true, and what worked, recalled by value under a budget rather than by recency, and corrected by superseding rather than editing in place, so the history of a decision survives the decision changing. Beside it, the Skills library holds the versioned SKILL.md entries your org authors, adopts against repos, and syncs from CLI and CI. Both are readable by your own agents over scoped org API tokens, so what the org learned rides along in every agent's context, not just every browser tab.",
    points: [
      { text: "Value-ranked recall returns what is worth returning, not merely what was written last: budget-packed to drop straight into a context window", anchors: at("memory") },
      { text: "Supersede-not-overwrite keeps the record of why the previous answer was the previous answer", anchors: at("memory") },
      { text: "Skill dormancy flags the library entries nobody has used inside the window, so the shelf stays honest", anchors: at("skills") },
      { text: "Scoped API tokens (skills read/write, usage telemetry, memory recall) open the library to CLIs, CI jobs and agents: shared knowledge only, never anyone's private scratch", anchors: at("skills") },
    ],
    value: "The reasoning behind last quarter's decision is still in the room when the person who made it isn't, and in your agents' context too.",
  },
  {
    id: "governance",
    tab: "governance",
    kickerSuffix: "policy & evidence",
    bodyAnchors: at("governance", "audit"),
    title: "Walk into the audit with the evidence already assembled",
    body: "Branch protection, required review and rulesets are audited across every repository and rolled up into one sheet, with a per-org merge-gate policy you set once. Underneath it sits a searchable, paginated audit trail of every consequential action (who changed the policy, who applied the batch, who was promoted), recorded as it happened rather than reconstructed afterwards.",
    points: [
      { text: "One governance sheet covering the whole fleet, not a per-repo settings tour", anchors: at("governance") },
      { text: "An org-wide gate policy that decides what a failing scan does to a pull request", anchors: at("governance") },
      { text: "An append-only trail with roles and membership beside it, so 'who could have done this' has an answer", anchors: at("audit", "members") },
    ],
    value: "Security review stops being a two-week archaeology project.",
  },
];

/** The rendered features, with each kicker's module half read from the shipping nav. */
export const ABOUT_ORG_FEATURES: AboutOrgFeatureData[] = SPECS.map(({ tab, kickerSuffix, bodyAnchors, points, ...rest }) => ({
  ...rest,
  points: points.map((p) => p.text),
  anchors: { body: bodyAnchors, points: points.map((p) => p.anchors) },
  kicker: `${orgGroupLabelFor(tab) ?? "In the org dashboard"} · ${kickerSuffix}`,
}));
