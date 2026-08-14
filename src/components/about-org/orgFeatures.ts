// The three org-only capabilities /about-org goes deep on, in narrative order.
//
// Chosen to NOT overlap /about (src/components/about/features.ts), which already sells the fleet
// X-ray, the ROI simulator, adoption and risk. Two marketing pages that make the same four arguments
// give a reader no reason to read the second one. These three are the muscle a per-repo tool cannot
// have at all: fleet-wide application, institutional knowledge, and governance evidence.
//
// Same shape as ABOUT_FEATURES so both decks can render through the shared AboutFeature section.

export type AboutOrgFeatureId = "practices" | "knowledge" | "governance";

interface AboutOrgFeatureData {
  id: AboutOrgFeatureId;
  kicker: string;
  title: string;
  body: string;
  points: string[];
  /** The money line — the one-sentence takeaway. */
  value: string;
}

export const ABOUT_ORG_FEATURES: AboutOrgFeatureData[] = [
  {
    id: "practices",
    kicker: "Plan · the practice library",
    title: "Fix it once. Apply it across the fleet.",
    body: "A practice turns a finding into an artifact: Ascent scaffolds a starter file tailored to the target repo's language — a CI workflow, an AGENTS.md, an ADR template — and opens it as a draft pull request your team reviews and merges. One authored practice can be applied to a batch of repositories in a single action instead of being re-explained team by team.",
    points: [
      "Nine practices, one per scored dimension, generated deterministically — no LLM, no keys, no leaked repo detail",
      "Batch apply opens draft PRs across up to 25 repositories per run",
      "The backlog carries every remaining gap with an owner and a due date — searchable, bulk-editable, exportable as CSV",
    ],
    value: "The gap analysis stops being a slide and starts being a set of open pull requests.",
  },
  {
    id: "knowledge",
    kicker: "Library · memory & skills",
    title: "Institutional memory that outlives the org chart",
    body: "Shared Org Memory is a durable store of what happened, what is true, and what worked — recalled by value under a budget rather than by recency, and corrected by superseding rather than editing in place, so the history of a decision survives the decision changing. Beside it, the Skills library holds the versioned SKILL.md entries your org authors, adopts against repos, and syncs from CLI and CI. Both are readable by your own agents over scoped org API tokens, so what the org learned rides along in every agent's context — not just every browser tab.",
    points: [
      "Value-ranked recall returns what is worth returning, not merely what was written last — budget-packed to drop straight into a context window",
      "Supersede-not-overwrite keeps the record of why the previous answer was the previous answer",
      "Skill dormancy flags the library entries nobody has used inside the window, so the shelf stays honest",
      "Scoped API tokens (skills read/write, usage telemetry, memory recall) open the library to CLIs, CI jobs and agents — shared knowledge only, never anyone's private scratch",
    ],
    value: "The reasoning behind last quarter's decision is still in the room when the person who made it isn't — and in your agents' context too.",
  },
  {
    id: "governance",
    kicker: "Govern · policy & evidence",
    title: "Walk into the audit with the evidence already assembled",
    body: "Branch protection, required review and rulesets are audited across every repository and rolled up into one sheet, with a per-org merge-gate policy you set once. Underneath it sits a searchable, paginated audit trail of every consequential action — who changed the policy, who applied the batch, who was promoted — recorded as it happened rather than reconstructed afterwards.",
    points: [
      "One governance sheet covering the whole fleet, not a per-repo settings tour",
      "An org-wide gate policy that decides what a failing scan does to a pull request",
      "An append-only trail with roles and membership beside it, so 'who could have done this' has an answer",
    ],
    value: "Security review stops being a two-week archaeology project.",
  },
];
