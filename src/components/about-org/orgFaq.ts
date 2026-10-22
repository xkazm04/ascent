// The /about-org FAQ: the single source of the page's FAQPage rich result (src/app/about-org/page.tsx
// only serializes `orgFaqLd()`). Distinct from the landing's FAQ, which answers scoring questions about
// one repository. Every answer restates something the product ships, and names it in `anchors` so the
// claim gate (src/components/about/claimAnchors.test.ts) fails when that capability retires: a search
// rich result is the one place a stale claim is quoted by someone else, so it is the worst place for one.

import type { ClaimAnchor } from "@/components/about/claimAnchors";
import { publicBaseUrl } from "@/lib/site";
import { MODULE_COUNT, VIEW_COUNT } from "./orgModules";

export interface OrgFaqEntry {
  question: string;
  answer: string;
  anchors: ClaimAnchor[];
}

export const ORG_FAQ: OrgFaqEntry[] = [
  {
    question: "What does Ascent's organization edition add over a single repository report?",
    answer: `It aggregates. Ascent scores every repository in the org and rolls the results into ${MODULE_COUNT} modules across ${VIEW_COUNT} views: a fleet rollup and trajectory, per-team and per-stack breakdowns, contributor and delivery signals, a proposals ledger of every change awaiting a decision, a shared knowledge library, and governance with an audit trail.`,
    anchors: [
      { tab: "overview" },
      { tab: "teams" },
      { tab: "tech-stacks" },
      { tab: "contributors" },
      { tab: "delivery" },
      { tab: "proposals" },
      { tab: "knowledge" },
      { tab: "governance" },
      { tab: "audit" },
    ],
  },
  {
    question: "Can one fix be applied across many repositories at once?",
    answer:
      "Yes. A practice scaffolds a starter artifact tailored to the target repository's language and opens it as a draft pull request; batch apply runs it across up to 25 repositories per call, and the Proposals ledger keeps the remaining gaps in view until the next scan closes what landed.",
    anchors: [{ tab: "practices" }, { tab: "proposals" }],
  },
  {
    question: "Does Ascent clone or store our source code?",
    // Same correction as the landing's FAQ (src/app/page.tsx): a flat "does not store its source" is
    // contradicted by the evidence quotes rubric r9 records (src/lib/scoring/claims.ts).
    answer:
      "Ascent never clones a repository and never keeps a copy of your source: it reads through the GitHub API at scan time. The report does keep the evidence a score rests on: short verbatim quotes with the file path each came from, so a score can be checked instead of trusted. Reports live inside your plan's retention window.",
    anchors: [{ route: "/report" }, { tab: "settings" }],
  },
  {
    question: "Is there an audit trail?",
    answer:
      "Yes. Every consequential action in the org (gate-policy changes, batch applies, role changes, completed scans) is recorded in a searchable, paginated audit trail, alongside governance rollups covering branch protection, required review and rulesets across the fleet.",
    anchors: [{ tab: "audit" }, { tab: "governance" }],
  },
];

/** The FAQPage JSON-LD, mapped from ORG_FAQ so the rich result cannot drift from the source list. */
export function orgFaqLd() {
  const base = publicBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    ...(base ? { "@id": `${base}/about-org` } : {}),
    mainEntity: ORG_FAQ.map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: { "@type": "Answer", text: q.answer },
    })),
  };
}
