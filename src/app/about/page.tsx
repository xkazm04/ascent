import type { Metadata } from "next";
import { SiteHeader } from "@/components/Brand";
import { AboutLanding } from "@/components/about/AboutLanding";

export const metadata: Metadata = {
  title: "About Ascent — the maturity index for AI-native engineering",
  description:
    "Ascent scores your organization's AI-development maturity and shows the highest-ROI path from manual development to a fully LLM-based, governed engineering org.",
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
