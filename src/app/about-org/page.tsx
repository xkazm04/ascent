import type { Metadata } from "next";
import { SiteHeader } from "@/components/Brand";
import { AboutOrgLanding } from "@/components/about-org/AboutOrgLanding";
import { MODULE_COUNT, VIEW_COUNT } from "@/components/about-org/orgModules";
import { publicBaseUrl } from "@/lib/site";

const TITLE = "Ascent for organizations, the AI-native index for your whole engineering fleet";
const DESCRIPTION = `Score every repository in your GitHub organization and roll it into one governed operating picture: ${MODULE_COUNT} modules and ${VIEW_COUNT} views, from the executive briefing to the audit trail.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/about-org" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/about-org",
    type: "website",
  },
};

// Counts in the copy above are DERIVED from the org nav catalog (see components/about-org/
// orgModules.ts), so the search snippet and the page can't disagree about how big the product is.

// A FAQ block for the org edition, distinct from the landing's (which answers scoring questions about
// one repository). Every answer restates something the page itself renders, so a rich result can't
// promise more than the page delivers.
function faqLd() {
  const base = publicBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    ...(base ? { "@id": `${base}/about-org` } : {}),
    mainEntity: [
      {
        "@type": "Question",
        name: "What does Ascent's organization edition add over a single repository report?",
        acceptedAnswer: {
          "@type": "Answer",
          text: `It aggregates. Ascent scores every repository in the org and rolls the results into ${MODULE_COUNT} modules across ${VIEW_COUNT} views: a fleet rollup and trajectory, per-team and per-stack breakdowns, contributor and delivery signals, a planning surface with a what-if simulator, a shared knowledge library, and governance with an audit trail.`,
        },
      },
      {
        "@type": "Question",
        name: "Can one fix be applied across many repositories at once?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes. A practice scaffolds a starter artifact tailored to the target repository's language and opens it as a draft pull request; batch apply runs it across up to 25 repositories per call, and the backlog tracks the remaining gaps with an owner and a due date.",
        },
      },
      {
        "@type": "Question",
        name: "Does Ascent clone or store our source code?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. Ascent reads repositories through the GitHub API at scan time. It never clones a repository and does not store its source.",
        },
      },
      {
        "@type": "Question",
        name: "Is there an audit trail?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes. Every consequential action in the org (gate-policy changes, batch applies, role changes, completed scans) is recorded in a searchable, paginated audit trail, alongside governance rollups covering branch protection, required review and rulesets across the fleet.",
        },
      },
    ],
  };
}

export default function AboutOrgPage() {
  return (
    <>
      {/* Static, page-derived strings — safe to inline. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd()) }} />
      <SiteHeader />
      <AboutOrgLanding />
    </>
  );
}
