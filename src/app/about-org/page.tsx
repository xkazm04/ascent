import type { Metadata } from "next";
import { SiteHeader } from "@/components/Brand";
import { AboutOrgLanding } from "@/components/about-org/AboutOrgLanding";
import { MODULE_COUNT, VIEW_COUNT } from "@/components/about-org/orgModules";
import { orgFaqLd } from "@/components/about-org/orgFaq";
import { jsonLdScript } from "@/lib/site";

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

// The FAQ rich result is mapped from ORG_FAQ (components/about-org/orgFaq.ts), where every answer
// names the capability it rests on and the claim gate checks it against the shipping tab catalog.

export default function AboutOrgPage() {
  return (
    <>
      {/* Page-derived strings, inlined through the shared jsonLdScript escaper (lib/site) so this
          stays safe if a dynamic field is ever added. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(orgFaqLd()) }} />
      <SiteHeader />
      <AboutOrgLanding />
    </>
  );
}
