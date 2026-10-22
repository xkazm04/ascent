import type { Metadata } from "next";
import { SiteHeader } from "@/components/Brand";
import { AboutLanding } from "@/components/about/AboutLanding";
import { DIMENSION_COUNT, LEVEL_COUNT } from "@/lib/site";
import { getPublicScanGallery } from "@/lib/db";
import { degradeTo } from "@/lib/scan-read-door";

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

// Card about-1: the X-Ray + ROI panes run on the scanned public fleet. ISR on the same 60 s window as
// the gallery's own unstable_cache (scans-read.ts), so /about is served static and refreshed at most
// once a minute. The read is bounded (40 recent cards) and reduced to plain props for the client deck.
// No DATABASE_URL (a build, a fresh self-host) returns null without a query, and a DB-down or a thrown
// read degrades to null through the error door: the page renders the labelled illustration, never a 500.
export const revalidate = 60;

export default async function AboutPage() {
  const gallery = await getPublicScanGallery({ recentLimit: 40 }).catch(degradeTo("about: getPublicScanGallery", null));
  return (
    <>
      <SiteHeader />
      <AboutLanding heroBg={HERO_BG} gallery={gallery} />
    </>
  );
}
