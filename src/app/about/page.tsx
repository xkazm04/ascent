import type { Metadata } from "next";
import { SiteHeader } from "@/components/Brand";
import { AboutLanding } from "@/components/about/AboutLanding";
import { DIMENSION_COUNT, LEVEL_COUNT } from "@/lib/site";

export const metadata: Metadata = {
  title: "About Ascent: the maturity index for AI-native engineering",
  // GOLDEN-TRIO: do not lead with ROI. Same three ingredients as siteDescription() (score + ladder +
  // evidence); counts are derived so the search snippet cannot drift from the model.
  description: `Ascent scores how AI-native your engineering org is: a ${LEVEL_COUNT}-level maturity ladder across ${DIMENSION_COUNT} dimensions, with evidence and a roadmap to the next level.`,
};

// The hero's generated backdrop is optional depth. It's a committed public asset, so Next serves and
// optimizes it in every environment — render it unconditionally rather than probing the dev filesystem
// with existsSync(), which returns false on bundled/serverless prod targets (where public/ is served by
// the CDN, not under the server bundle's cwd) and would silently drop the backdrop in prod only. If it
// ever fails to load, AboutHero degrades to its CSS strata/glow via the <Image> onError handler.
const HERO_BG = "/brand/proto/about-hero-bg.png";

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <AboutLanding heroBg={HERO_BG} />
    </>
  );
}
